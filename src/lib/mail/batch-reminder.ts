import { escapeHtml } from './escape';
import { deadlinePhrase } from '@/lib/deadline';
import { dataEntryUrl } from '@/lib/redcap/deep-link';
import type { PersonBacklog } from '@/lib/state/backlog';
import type { Batch } from '@/lib/db/batches';

/**
 * The batch reminder: "this many records of yours are still open, and the
 * deadline is this".
 *
 * Written from the same backlog computation the operator is looking at, so the
 * number in the mail and the number on screen are the same number.
 */

/** Enough ids to start on; the full list would be a wall of text. */
const MAX_LINKS_PER_UNIT = 15;

export function batchReminderMail(batch: Batch, backlog: PersonBacklog, redcapBase: string, note?: string) {
  const phrase = deadlinePhrase(batch.dueDate);
  const deadline = batch.dueDate ? `${batch.dueDate}（${phrase}）` : '未設定截止日';

  const sections = backlog.units.map(unit => {
    const links = (ids: string[]) => ids.slice(0, MAX_LINKS_PER_UNIT)
      .map(id => `<a href="${escapeHtml(dataEntryUrl(redcapBase, id, unit.deepLinkPage))}">${escapeHtml(id)}</a>`)
      .join('、')
      + (ids.length > MAX_LINKS_PER_UNIT ? `　…等共 ${ids.length} 筆` : '');

    const parts: string[] = [];
    if (unit.ready.length > 0) {
      parts.push(`<p style="margin:4px 0;">尚未填寫（${unit.ready.length} 筆）：${links(unit.ready)}</p>`);
    }
    if (unit.awaiting.length > 0) {
      parts.push(`<p style="margin:4px 0;">待您確認簽核（${unit.awaiting.length} 筆）：${links(unit.awaiting)}</p>`);
    }
    return `<h3 style="margin:16px 0 4px;font-size:15px;">${escapeHtml(unit.label)}　<span style="color:#666;font-weight:normal;">還缺 ${unit.ready.length + unit.awaiting.length} 筆</span></h3>${parts.join('')}`;
  }).join('');

  return {
    subject: `OHCA 登錄提醒：${batch.name} 還有 ${backlog.total} 筆未完成${batch.dueDate ? `（${phrase}）` : ''}`,
    html: `
      <div style="font-family: -apple-system, 'Noto Sans TC', sans-serif; line-height: 1.6; max-width: 640px;">
        <p>${escapeHtml(backlog.displayName)} 您好，</p>
        <p>
          目前這一批（<strong>${escapeHtml(batch.name)}</strong>，收案編號 ≤ ${batch.studyIdCutoff}）
          還有 <strong>${backlog.total} 筆</strong>掛在您名下尚未完成。
        </p>
        <p style="background:#f4f6fb;border-left:3px solid #2563eb;padding:8px 12px;margin:12px 0;">
          截止日：<strong>${escapeHtml(deadline)}</strong>
        </p>
        ${sections}
        ${note ? `<p style="border-left:3px solid #999;padding-left:12px;color:#444;">${escapeHtml(note)}</p>` : ''}
        <p style="color:#666;font-size:13px;margin-top:20px;">
          每個編號都直接連到 REDCap 的輸入頁。清單只列出「現在就可以動工」的項目——
          還在等別人先填的部分不會出現在這裡，等輪到您時會再通知。
        </p>
      </div>
    `,
  };
}
