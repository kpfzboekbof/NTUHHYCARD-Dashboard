import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { findById } from '@/lib/people/repo';
import { getAssignments } from '@/lib/owner-store';
import { LEGACY_FORM_BY_UNIT_ID } from '@/lib/catalog/seed';
import { deriveCurrentMatrix, type CurrentMatrix } from '@/lib/state/build';
import { getCachedAsync } from '@/lib/cache';
import { getDataEntryBase, dataEntryUrl } from '@/lib/redcap/deep-link';
import { createTransporter, escapeHtml } from '@/lib/mailer';
import { recordMailAttempt, markMailSent, markMailFailed } from '@/lib/db/outbound-mail';
import { recordAudit } from '@/lib/db/audit';
import type { RecordDerivation } from '@/lib/state/types';

/**
 * POST /api/nudge — mail one person their current backlog, on the operator's
 * say-so.
 *
 * Deliberately never automatic (§7.1): the saving from automation is not
 * having to remember, the cost is the recipient learning to ignore the
 * sender — and only the operator knows this person is in theatre this week.
 * The mail is built server-side from the live matrix so it cannot disagree
 * with what the operator was looking at in any way that matters.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_LINKS_PER_UNIT = 10;

interface UnitBacklog {
  unitId: string;
  label: string;
  deepLinkPage: string;
  ready: string[];
  awaiting: string[];
}

interface MatrixLike {
  records: RecordDerivation[];
  units: Array<{ unitId: string; label: string; deepLinkPage: string }>;
  fetchedAt: string;
}

/** The matrix the operator is already looking at, or a fresh one. */
async function currentMatrix(): Promise<MatrixLike> {
  const cached = await getCachedAsync<MatrixLike>('state-matrix');
  if (cached?.records && cached.units) return cached;
  const fresh: CurrentMatrix = await deriveCurrentMatrix();
  return fresh;
}

function taipeiTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function nudgeEmail(
  displayName: string,
  backlog: UnitBacklog[],
  redcapBase: string,
  note: string | undefined,
  fetchedAt: string,
) {
  const totalReady = backlog.reduce((n, u) => n + u.ready.length, 0);
  const totalAwaiting = backlog.reduce((n, u) => n + u.awaiting.length, 0);

  const sections = backlog.map(unit => {
    const links = (ids: string[]) => ids.slice(0, MAX_LINKS_PER_UNIT)
      .map(id => `<a href="${escapeHtml(dataEntryUrl(redcapBase, id, unit.deepLinkPage))}">${escapeHtml(id)}</a>`)
      .join('、')
      + (ids.length > MAX_LINKS_PER_UNIT ? ` …等 ${ids.length} 筆` : '');

    const parts: string[] = [];
    if (unit.ready.length > 0) parts.push(`<p>可以開始（${unit.ready.length} 筆）：${links(unit.ready)}</p>`);
    if (unit.awaiting.length > 0) parts.push(`<p>待確認簽核（${unit.awaiting.length} 筆）：${links(unit.awaiting)}</p>`);
    return `<h3 style="margin:16px 0 4px;">${escapeHtml(unit.label)}</h3>${parts.join('')}`;
  }).join('');

  return {
    subject: `OHCA 登錄提醒：您名下有 ${totalReady + totalAwaiting} 筆可以進行`,
    html: `
      <div style="font-family: -apple-system, 'Noto Sans TC', sans-serif; line-height: 1.6; max-width: 640px;">
        <p>${escapeHtml(displayName)} 您好，</p>
        <p>以下是目前掛在您名下、可以進行的登錄工作（依 ${escapeHtml(taipeiTime(fetchedAt))} 的資料）：</p>
        ${sections}
        ${note ? `<p style="border-left:3px solid #2563eb;padding-left:12px;">${escapeHtml(note)}</p>` : ''}
        <p style="color:#666;font-size:13px;">每個編號都直接連到 REDCap 的輸入頁。這封信由資料庫負責人送出。</p>
      </div>
    `,
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
    if (!person.redcapUsername) {
      return NextResponse.json(
        { error: `${person.displayName} 沒有連結 REDCap 帳號，無法對應到任何單元` },
        { status: 400 },
      );
    }

    const [matrix, assignments, redcapBase] = await Promise.all([
      currentMatrix(),
      getAssignments(),
      getDataEntryBase(),
    ]);

    // Phase 3–4 transitional ownership: the unit is theirs when the legacy
    // form-keyed assignment names their REDCap username.
    const ownedUnitIds = new Set(
      matrix.units
        .filter(unit => assignments[LEGACY_FORM_BY_UNIT_ID[unit.unitId] ?? unit.unitId] === person.redcapUsername)
        .map(unit => unit.unitId),
    );
    if (ownedUnitIds.size === 0) {
      return NextResponse.json(
        { error: `${person.displayName}（${person.redcapUsername}）目前沒有被指派任何表單` },
        { status: 400 },
      );
    }

    const byUnit = new Map<string, UnitBacklog>(
      matrix.units
        .filter(unit => ownedUnitIds.has(unit.unitId))
        .map(unit => [unit.unitId, { ...unit, ready: [], awaiting: [] }]),
    );
    for (const record of matrix.records) {
      for (const cell of record.cells) {
        const backlog = byUnit.get(cell.unitId);
        if (!backlog) continue;
        if (cell.state === 'ready') backlog.ready.push(record.studyId);
        else if (cell.state === 'entered_awaiting_verify') backlog.awaiting.push(record.studyId);
      }
    }
    const backlog = [...byUnit.values()].filter(u => u.ready.length > 0 || u.awaiting.length > 0);
    if (backlog.length === 0) {
      return NextResponse.json({ ok: false, empty: true, message: '目前沒有可以進行的項目，不需要提醒' });
    }

    const mail = nudgeEmail(person.displayName, backlog, redcapBase, note, matrix.fetchedAt);
    const payload = {
      units: backlog.map(u => ({ unitId: u.unitId, label: u.label, ready: u.ready.length, awaiting: u.awaiting.length })),
      note: note ?? null,
      matrixFetchedAt: matrix.fetchedAt,
    };

    // The attempt is recorded before the send: a crash mid-way must leave
    // "attempted, unconfirmed" in the ledger, never nothing.
    const mailId = await recordMailAttempt({
      toPersonId: person.id,
      toEmail: person.email,
      kind: 'nudge',
      payload,
      requestedBy: auth.identity.personId,
    });

    const transporter = createTransporter();
    if (!transporter) {
      await markMailFailed(mailId, 'GMAIL_USER / GMAIL_APP_PASSWORD 未設定');
      return NextResponse.json({ error: '未設定 GMAIL_USER 或 GMAIL_APP_PASSWORD，無法寄信' }, { status: 500 });
    }

    try {
      await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: person.email,
        subject: mail.subject,
        html: mail.html,
      });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      await markMailFailed(mailId, message);
      return NextResponse.json({ error: `寄送失敗：${message}` }, { status: 502 });
    }

    await markMailSent(mailId);
    await recordAudit({
      actor: auth.identity.actor,
      action: 'nudge.send',
      entityType: 'person',
      entityId: person.id,
      after: payload,
    });

    return NextResponse.json({
      ok: true,
      to: person.email,
      units: payload.units,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
