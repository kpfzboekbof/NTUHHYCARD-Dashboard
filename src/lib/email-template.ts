const REDCAP_BASE = 'https://redcap.ntuh.gov.tw/redcap_v16.1.9/DataEntry/index.php?pid=8207';

export interface RsvpLinks {
  baseUrl: string;        // e.g. https://ohca.example.com
  labelerCode: number;
  signature: string;      // verifyRsvp signature for (code, meetingDate)
}

export function buildReminderEmail(
  labelerName: string,
  meetingDate: string,
  incompleteCaseIds: string[],
  idRange?: { from: number | null; to: number | null },
  rsvp?: RsvpLinks,
): { subject: string; html: string } {
  const count = incompleteCaseIds.length;
  const isComplete = count === 0;
  const subject = isComplete
    ? `[OHCA Etiology] 共識會議出席確認`
    : `[OHCA Etiology] 共識會議提醒 — ${count} 筆待完成`;

  const rangeText = idRange?.from != null && idRange?.to != null
    ? `（ID ${idRange.from} ~ ${idRange.to}）`
    : idRange?.from != null
      ? `（ID ≥ ${idRange.from}）`
      : idRange?.to != null
        ? `（ID ≤ ${idRange.to}）`
        : '';

  const caseRows = incompleteCaseIds
    .map(id => {
      const url = `${REDCAP_BASE}&id=${id}&page=ntuh_nhi_etiology`;
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;">
          <a href="${url}" style="color:#2563eb;text-decoration:none;">${id}</a>
        </td>
      </tr>`;
    })
    .join('\n');

  const bodySection = isComplete
    ? `
  <p>${labelerName} 您好，</p>
  <p>感謝您！您所有的死因判讀皆已完成${rangeText}，辛苦了 🙏</p>
  <p>下次的死因共識會議將於 <strong>${meetingDate}</strong> 舉行，想確認您是否會出席，請於下方點選回覆。</p>`
    : `
  <p>${labelerName} 您好，</p>
  <p>您還有 <strong>${count}</strong> 筆未完成的死因判讀${rangeText}，請在 <strong>${meetingDate}</strong> 前完成，感謝您對 OHCA 資料庫之貢獻。</p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d1d5db;">Study ID（點擊開啟 REDCap）</th>
      </tr>
    </thead>
    <tbody>
      ${caseRows}
    </tbody>
  </table>`;

  const rsvpSection = rsvp ? buildRsvpSection(rsvp, meetingDate) : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;max-width:600px;margin:0 auto;padding:20px;">
  <h2 style="color:#1f2937;margin-bottom:4px;">OHCA Etiology 共識會議${isComplete ? '出席確認' : '提醒'}</h2>
  <p style="color:#6b7280;margin-top:0;">此為系統自動發送的信件</p>
${bodySection}

  ${rsvpSection}

  <p style="color:#6b7280;font-size:14px;margin-top:24px;">
    如有疑問，請聯繫管理員。
  </p>
</body>
</html>`.trim();

  return { subject, html };
}

function buildRsvpSection(rsvp: RsvpLinks, meetingDate: string): string {
  const base = rsvp.baseUrl.replace(/\/$/, '');
  const params = (response: 'yes' | 'no') =>
    `code=${rsvp.labelerCode}&meeting=${encodeURIComponent(meetingDate)}&response=${response}&sig=${rsvp.signature}`;
  const yesUrl = `${base}/api/rsvp?${params('yes')}`;
  const noUrl  = `${base}/api/rsvp?${params('no')}`;

  return `
  <div style="margin:24px 0;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;">
    <p style="margin:0 0 12px;font-weight:600;">請問您是否會出席 ${meetingDate} 的死因共識會議？</p>
    <p style="margin:0 0 12px;color:#6b7280;font-size:13px;">點擊下列按鈕即可一鍵回覆，無需另外開啟系統登入。</p>
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:8px;">
        <a href="${yesUrl}" style="display:inline-block;padding:10px 20px;background:#10b981;color:#ffffff;font-weight:600;text-decoration:none;border-radius:6px;">✅ 我會參加</a>
      </td>
      <td>
        <a href="${noUrl}" style="display:inline-block;padding:10px 20px;background:#ef4444;color:#ffffff;font-weight:600;text-decoration:none;border-radius:6px;">❌ 我不會參加</a>
      </td>
    </tr></table>
    <p style="margin:12px 0 0;color:#9ca3af;font-size:12px;">如需更改回覆，再次點擊另一顆按鈕即可覆蓋。</p>
  </div>`;
}
