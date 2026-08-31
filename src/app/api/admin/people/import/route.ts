import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { hasDatabase } from '@/lib/db/client';
import { fetchUsers } from '@/lib/redcap/client';
import { createPerson, listPeople, updatePerson } from '@/lib/people/repo';
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

    // One person at a time: each write carries its own audit row, and a single
    // bad row (a duplicate email REDCap allows and this schema does not) should
    // not discard the rest of the import.
    const failed: { username: string; reason: string }[] = [];
    let created = 0;
    for (const item of plan.create) {
      try {
        await createPerson(item.input, auth.identity.actor);
        created++;
      } catch (error) {
        failed.push({
          username: item.input.redcapUsername ?? item.input.email,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    let updated = 0;
    for (const item of plan.update) {
      try {
        await updatePerson(item.id, item.changes, auth.identity.actor);
        updated++;
      } catch (error) {
        failed.push({
          username: item.displayName,
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
