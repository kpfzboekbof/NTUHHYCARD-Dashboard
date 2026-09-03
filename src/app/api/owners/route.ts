import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { recordAudit } from '@/lib/db/audit';
import { getRedcapUsers } from '@/lib/redcap/users';
import { readOwnerStore, getAssignments, setAssignments, getHiddenForms, setHiddenForms, getTargetIds, setTargetIds } from '@/lib/owner-store';
import { getLabelers, setLabelers } from '@/lib/labelers';
import { invalidateViews } from '@/lib/views/view';
import { WRITE_EFFECTS } from '@/lib/views/keys';
import type { Labeler } from '@/lib/redcap/etiology-transform';
import type { TargetIds } from '@/lib/owner-store';
import type { OwnerAssignments } from '@/types';

export async function GET() {
  try {
    const [users, { assignments, hiddenForms, targetIds }, labelers] = await Promise.all([
      getRedcapUsers(),
      readOwnerStore(),
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

    // Owners, hidden forms, targets and labelers are baked into every
    // REDCap-derived view; mark them so they rebuild.
    await invalidateViews(WRITE_EFFECTS.settings);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
