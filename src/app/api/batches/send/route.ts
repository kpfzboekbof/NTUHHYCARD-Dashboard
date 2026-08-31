import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { hasDatabase } from '@/lib/db/client';
import { findBatch } from '@/lib/db/batches';
import { loadBacklog } from '@/lib/state/backlog-source';
import { getDataEntryBase } from '@/lib/redcap/deep-link';
import { batchReminderMail } from '@/lib/mail/batch-reminder';
import { sendTrackedMail } from '@/lib/mail/send';
import { recordAudit } from '@/lib/db/audit';

/**
 * POST /api/batches/send — the one-click reminder for a batch.
 *
 * `?dryRun=1` returns exactly what would be sent to whom without sending it.
 * The preview is not friction: it is the thing that makes one click safe to
 * press, and it is the same computation the send uses, so what is previewed is
 * what goes out.
 *
 * Recipients are opt-out by omission: the caller passes the person ids it
 * wants mailed. A person with no registry link (or no email) is reported and
 * skipped rather than silently dropped — the operator needs to know why
 * somebody with a backlog did not get chased.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;
  if (!hasDatabase()) {
    return NextResponse.json({ error: '未設定 OHCA_DATABASE_URL：批次功能無法使用' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const batchId = typeof body.batchId === 'string' ? body.batchId : '';
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined;
    const only: string[] | null = Array.isArray(body.personIds) ? body.personIds : null;
    const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';

    if (!batchId) return NextResponse.json({ error: '缺少 batchId' }, { status: 400 });
    const batch = await findBatch(batchId);
    if (!batch) return NextResponse.json({ error: '找不到批次' }, { status: 404 });

    const [{ backlog, fetchedAt }, redcapBase] = await Promise.all([
      loadBacklog({ studyIdCutoff: batch.studyIdCutoff, unitIds: batch.unitIds }),
      getDataEntryBase(),
    ]);

    // Everyone with outstanding work, minus anyone the operator unticked.
    const selected = only
      ? backlog.filter(p => p.personId && only.includes(p.personId))
      : backlog;

    const mailable = selected.filter(p => p.personId && p.email);
    const unreachable = selected
      .filter(p => !p.personId || !p.email)
      .map(p => ({
        username: p.username,
        displayName: p.displayName,
        total: p.total,
        reason: p.personId ? '人員資料沒有 email' : '這個 REDCap 帳號還沒連結到人員登記表',
      }));

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        batch,
        fetchedAt,
        recipients: mailable.map(p => ({
          personId: p.personId,
          displayName: p.displayName,
          email: p.email,
          total: p.total,
          readyCount: p.readyCount,
          awaitingCount: p.awaitingCount,
          units: p.units.map(u => ({ label: u.label, remaining: u.ready.length + u.awaiting.length })),
          subject: batchReminderMail(batch, p, redcapBase, note).subject,
        })),
        unreachable,
      });
    }

    // One failure must not stop the rest: a batch half-sent with no report is
    // worse than a batch fully attempted with a list of what failed.
    const results = [];
    for (const person of mailable) {
      const mail = batchReminderMail(batch, person, redcapBase, note);
      const payload = {
        batchId: batch.id,
        batchName: batch.name,
        dueDate: batch.dueDate,
        studyIdCutoff: batch.studyIdCutoff,
        total: person.total,
        units: person.units.map(u => ({
          unitId: u.unitId, label: u.label, remaining: u.ready.length + u.awaiting.length,
        })),
        note: note ?? null,
      };

      const result = await sendTrackedMail({
        toPersonId: person.personId,
        toEmail: person.email!,
        kind: 'batch_due',
        subject: mail.subject,
        html: mail.html,
        payload,
        requestedBy: auth.identity.personId,
      });

      results.push({
        personId: person.personId,
        displayName: person.displayName,
        email: person.email,
        total: person.total,
        ...result,
      });
    }

    await recordAudit({
      actor: auth.identity.actor,
      action: 'batch.remind',
      entityType: 'batch',
      entityId: batch.id,
      after: {
        sent: results.filter(r => r.ok).map(r => r.email),
        failed: results.filter(r => !r.ok).map(r => ({ email: r.email, error: r.error })),
        unreachable,
        note: note ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      sent: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok),
      unreachable,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
