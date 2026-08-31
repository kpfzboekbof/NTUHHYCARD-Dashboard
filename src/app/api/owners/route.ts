import { NextResponse } from 'next/server';
import { getCachedAsync, setCached } from '@/lib/cache';
import { requireRole } from '@/lib/auth/identity';
import { recordAudit } from '@/lib/db/audit';
import { fetchUsers } from '@/lib/redcap/client';
import { getAssignments, setAssignments, getHiddenForms, setHiddenForms, getTargetIds, setTargetIds } from '@/lib/owner-store';
import { getLabelers, setLabelers } from '@/lib/labelers';
import type { Labeler } from '@/lib/redcap/etiology-transform';
import type { TargetIds } from '@/lib/owner-store';
import type { User, OwnerAssignments } from '@/types';

const USERS_CACHE_KEY = 'redcap_users';

async function getUsers(): Promise<User[]> {
  const cached = await getCachedAsync<User[]>(USERS_CACHE_KEY);
  if (cached) return cached;

  const raw = await fetchUsers();
  const users: User[] = raw.map(u => ({
    username: u.username,
    name: `${u.lastname}${u.firstname}`,
  }));

  setCached(USERS_CACHE_KEY, users, 1800);
  return users;
}

export async function GET() {
  try {
    const [users, assignments, hiddenForms, targetIds, labelers] = await Promise.all([
      getUsers(),
      getAssignments(),
      getHiddenForms(),
      getTargetIds(),
      getLabelers(),
    ]);
    return NextResponse.json({ users, assignments, hiddenForms, targetIds, labelers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  try {
    const body: { assignments?: OwnerAssignments; hiddenForms?: string[]; targetIds?: TargetIds; labelers?: Labeler[] } = await request.json();

    // Assignments used to overwrite one blob with no history at all, so
    // "who moved this form to me, and when" had no answer. Record the previous
    // value alongside the new one.
    if (body.assignments !== undefined) {
      const before = await getAssignments();
      await setAssignments(body.assignments);
      await recordAudit({
        actor: auth.identity.actor,
        action: 'assignments.set',
        entityType: 'owner_assignments',
        entityId: 'global',
        before,
        after: body.assignments,
      });
    }
    if (body.hiddenForms !== undefined) {
      const before = await getHiddenForms();
      await setHiddenForms(body.hiddenForms);
      await recordAudit({
        actor: auth.identity.actor,
        action: 'hidden_forms.set',
        entityType: 'owner_assignments',
        entityId: 'hiddenForms',
        before,
        after: body.hiddenForms,
      });
    }
    if (body.targetIds !== undefined) {
      const before = await getTargetIds();
      await setTargetIds(body.targetIds);
      await recordAudit({
        actor: auth.identity.actor,
        action: 'target_ids.set',
        entityType: 'owner_assignments',
        entityId: 'targetIds',
        before,
        after: body.targetIds,
      });
    }
    if (body.labelers !== undefined) {
      const before = await getLabelers();
      await setLabelers(body.labelers);
      await recordAudit({
        actor: auth.identity.actor,
        action: 'labelers.set',
        entityType: 'labelers',
        entityId: 'global',
        before,
        after: body.labelers,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
