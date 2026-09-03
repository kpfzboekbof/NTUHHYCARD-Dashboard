import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { findById } from '@/lib/people/repo';
import { loadBacklog } from '@/lib/state/backlog-source';
import { getDataEntryBase } from '@/lib/redcap/deep-link';
import { batchReminderMail } from '@/lib/mail/batch-reminder';
import { sendTrackedMail } from '@/lib/mail/send';
import { recordAudit } from '@/lib/db/audit';
import type { Batch } from '@/lib/db/batches';

/**
 * POST /api/nudge — mail one person everything currently outstanding for them,
 * with no batch and no deadline.
 *
 * Deliberately never automatic (§7.1): the saving from automation is not
 * having to remember, the cost is the recipient learning to ignore the
 * sender — and only the operator knows this person is in theatre this week.
 *
 * Shares the backlog computation and the mail body with the batch reminder, so
 * the count here and the count on the operator's screen are one number.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

/** The matrix behind a reminder may be this old; older, and it is re-derived first. */
const FRESH_ENOUGH_TO_MAIL_SECONDS = 600;

/** A nudge is a batch with no cutoff and no deadline; the body is the same. */
function unscopedBatch(): Batch {
  return {
    id: 'unscoped',
    name: '目前所有待辦',
    studyIdCutoff: Number.MAX_SAFE_INTEGER,
    dueDate: null,
    unitIds: [],
    createdBy: null,
    createdAt: new Date().toISOString(),
    closedAt: null,
  };
}

export async function POST(request: Request) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const personId = typeof body.personId === 'string' ? body.personId : '';
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined;
    if (!personId) return NextResponse.json({ error: '缺少 personId' }, { status: 400 });

    const person = await findById(personId);
    if (!person || !person.active) return NextResponse.json({ error: '找不到人員或已停用' }, { status: 404 });

    // A mail that lists work somebody already finished teaches them to ignore
    // the sender: the matrix behind it must be recent, whatever the screen
    // was happy to show.
    const [{ backlog }, redcapBase] = await Promise.all([
      loadBacklog({}, { maxAgeSeconds: FRESH_ENOUGH_TO_MAIL_SECONDS }),
      getDataEntryBase(),
    ]);
    const theirs = backlog.find(p => p.personId === person.id);

    if (!theirs) {
      // Either nothing is assigned to their REDCap username, or everything
      // assigned is done or blocked. Both mean there is nothing to chase, and
      // a "you have 0 remaining" mail teaches people to ignore the sender.
      return NextResponse.json({
        ok: false,
        empty: true,
        message: `${person.displayName} 目前沒有可以進行的項目，不需要提醒`,
      });
    }

    const batch = unscopedBatch();
    const mail = batchReminderMail(batch, theirs, redcapBase, note);
    const payload = {
      total: theirs.total,
      units: theirs.units.map(u => ({
        unitId: u.unitId, label: u.label, remaining: u.ready.length + u.awaiting.length,
      })),
      note: note ?? null,
    };

    const result = await sendTrackedMail({
      toPersonId: person.id,
      toEmail: person.email,
      kind: 'nudge',
      subject: mail.subject,
      html: mail.html,
      payload,
      requestedBy: auth.identity.personId,
    });

    if (!result.ok) {
      return NextResponse.json({ error: `寄送失敗：${result.error}` }, { status: 502 });
    }

    await recordAudit({
      actor: auth.identity.actor,
      action: 'nudge.send',
      entityType: 'person',
      entityId: person.id,
      after: payload,
    });

    return NextResponse.json({ ok: true, to: person.email, units: payload.units, total: theirs.total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
