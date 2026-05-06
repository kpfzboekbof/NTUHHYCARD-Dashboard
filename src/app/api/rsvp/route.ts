import { NextRequest, NextResponse } from 'next/server';
import { getMeetingSettings, setMeetingSettings, type RsvpResponse } from '@/lib/meeting-store';
import { getLabelers } from '@/lib/labelers';
import { verifyRsvp } from '@/lib/rsvp-token';

export const dynamic = 'force-dynamic';

function htmlPage(opts: { title: string; heading: string; message: string; accent: 'green' | 'red' | 'amber' }): string {
  const accent = {
    green: { bg: '#ecfdf5', border: '#10b981', text: '#065f46' },
    red:   { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
    amber: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
  }[opts.accent];

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${opts.title}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;background:#f9fafb;margin:0;padding:48px 16px;">
  <div style="max-width:480px;margin:0 auto;background:${accent.bg};border:1px solid ${accent.border};border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 12px;font-size:20px;color:${accent.text};">${opts.heading}</h1>
    <p style="margin:0;line-height:1.6;color:${accent.text};">${opts.message}</p>
  </div>
  <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:24px;">OHCA Etiology 共識會議系統</p>
</body>
</html>`;
}

function send(html: string, status = 200): NextResponse {
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** GET /api/rsvp?code=3&meeting=2026-06-15&response=yes&sig=XXX */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codeStr = searchParams.get('code');
  const meeting = searchParams.get('meeting');
  const response = searchParams.get('response') as RsvpResponse | null;
  const sig = searchParams.get('sig');

  const code = codeStr ? parseInt(codeStr) : NaN;

  if (Number.isNaN(code) || !meeting || !sig || (response !== 'yes' && response !== 'no')) {
    return send(htmlPage({
      title: 'RSVP — 連結無效',
      heading: '連結無效',
      message: '此 RSVP 連結缺少必要參數，請從最新一封提醒信點選按鈕。',
      accent: 'amber',
    }), 400);
  }

  if (!verifyRsvp(code, meeting, sig)) {
    return send(htmlPage({
      title: 'RSVP — 簽章錯誤',
      heading: '連結已失效',
      message: '此 RSVP 連結的簽章無法驗證。請聯絡管理員重新發送提醒信。',
      accent: 'red',
    }), 401);
  }

  const [labelers, settings] = await Promise.all([getLabelers(), getMeetingSettings()]);
  const labeler = labelers.find(l => l.code === code);
  const labelerName = labeler?.name ?? `Labeler ${code}`;

  // Persist the response keyed by labeler. The entry stores its meetingDate so
  // the dashboard can ignore RSVPs from previous meetings.
  settings.rsvps = { ...settings.rsvps };
  settings.rsvps[String(code)] = {
    response,
    respondedAt: new Date().toISOString(),
    meetingDate: meeting,
  };
  await setMeetingSettings(settings);

  const isYes = response === 'yes';
  const isStale = settings.meetingDate && settings.meetingDate !== meeting;

  const meetingNote = isStale
    ? `<br/><span style="color:#92400e;">⚠️ 此回覆對應的會議日期（${meeting}）與目前系統設定的（${settings.meetingDate}）不同，管理員可能已調整日期。如需更新請聯絡管理員。</span>`
    : '';

  return send(htmlPage({
    title: isYes ? 'RSVP — 已登記出席' : 'RSVP — 已登記不出席',
    heading: isYes ? '✅ 已登記出席' : '已登記不出席',
    message: `${labelerName} 您好，已收到您對 <strong>${meeting}</strong> 死因共識會議的回覆：<strong>${isYes ? '會參加' : '不會參加'}</strong>。<br/>如需修改，請再次點選提醒信中的另一個按鈕即可覆蓋此回覆。${meetingNote}`,
    accent: isYes ? 'green' : 'red',
  }));
}
