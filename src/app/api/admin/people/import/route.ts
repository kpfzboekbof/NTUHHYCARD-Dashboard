import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { hasDatabase } from '@/lib/db/client';
import { fetchUsers } from '@/lib/redcap/client';
import { createPeople, createPerson, listPeople, updatePerson } from '@/lib/people/repo';
import { planImport, type ImportPlan } from '@/lib/people/import-redcap';

/**
 * POST /api/admin/people/import — seed the registry from REDCap's user export.
 *
 * `?dryRun=1` returns the same plan without writing, so a manager can see what
 * a first import would do to a registry that already has people in it.
 */

export const runtime = 'nodejs';

async function buildPlan(): Promise<ImportPlan> {
  const [users, existing] = await Promise.all([fetchUsers(), listPeople(true)]);
  return planImport(users, existing);
}

export async function POST(request: Request) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: '未設定 OHCA_DATABASE_URL：人員登記表無法使用' },
      { status: 503 },
    );
  }

  try {
    const plan = await buildPlan();
    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        created: plan.create.length,
        updated: plan.update.length,
        plan,
      });
    }

    const failed: { username: string; reason: string }[] = [];

    // The whole batch in one transaction — dozens of round trips would run past
    // a serverless function's budget and could leave the registry half
    // populated. If one row is rejected (a duplicate email REDCap allows and
    // this schema does not), retry the rest one at a time to find out which.
    let created = 0;
    const inputs = plan.create.map(item => item.input);
    try {
      created = (await createPeople(inputs, auth.identity.actor)).length;
    } catch {
      created = 0;
      for (const input of inputs) {
        try {
          await createPerson(input, auth.identity.actor);
          created++;
        } catch (error) {
          failed.push({
            username: input.redcapUsername ?? input.email,
            reason: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // Updates stay one at a time: there are few of them after the first import,
    // and each carries the row it is changing, so no extra read.
    let updated = 0;
    for (const item of plan.update) {
      try {
        await updatePerson(item.current.id, item.changes, auth.identity.actor, item.current);
        updated++;
      } catch (error) {
        failed.push({
          username: item.current.displayName,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      created,
      updated,
      skipped: plan.skipped,
      failed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
