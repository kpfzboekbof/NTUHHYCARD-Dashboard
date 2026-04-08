const REDCAP_BASE = 'https://redcap.ntuh.gov.tw/redcap_v16.1.9/DataEntry/index.php?pid=8207';

export function buildReminderEmail(
  labelerName: string,
  meetingDate: string,
  incompleteCaseIds: string[],
  idRange?: { from: number | null; to: number | null },
): { subject: string; html: string } {
  const count = incompleteCaseIds.length;
  const subject = `[OHCA Etiology] 共識會議提醒 — ${count} 筆待完成`;

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

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;max-width:600px;margin:0 auto;padding:20px;">
  <h2 style="color:#1f2937;margin-bottom:4px;">OHCA Etiology 共識會議提醒</h2>
  <p style="color:#6b7280;margin-top:0;">此為系統自動發送的提醒信件</p>

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
  </table>

  <p style="color:#6b7280;font-size:14px;margin-top:24px;">
    如有疑問，請聯繫管理員。
  </p>
</body>
</html>`.trim();

  return { subject, html };
}
