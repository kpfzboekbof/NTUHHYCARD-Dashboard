import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';
import { authorizeCron } from '@/lib/auth/cron';
import { readBaseline } from '@/lib/state/baseline';
import { listPeople } from '@/lib/people/repo';
import { hasDatabase } from '@/lib/db/client';
import { createTransporter, escapeHtml } from '@/lib/mailer';
import { alreadySentToday, recordMailAttempt, markMailFailed, markMailSent } from '@/lib/db/outbound-mail';

/**
 * GET /api/cron/watchdog — the one thing that may interrupt the operator.
 *
 * Nothing here is about the people doing the work; it is about the system
 * itself being broken, which no queue can show — a stalled snapshot looks
 * exactly like everyone having stopped work, and a missing scraper upload
 * looks like a quiet day. One mail per condition per day, to the operator.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Hours after which the diff baseline counts as stale (daily cadence + slack). */
const STALE_HOURS = Number(process.env.SNAPSHOT_STALE_HOURS) || 30;
/** The scraper is expected by 09:00; alert this many hours later. */
const SCAN_GRACE_HOURS = 6;

function taipeiNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

function taipeiDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface Alert {
  kind: string;
  subject: string;
  body: string;
  payload: Record<string, unknown>;
}

async function checkBaseline(): Promise<Alert | null> {
  const baseline = await readBaseline();
  if (!baseline) {
    return {
      kind: 'snapshot_stale',
      subject: 'OHCA Dashboard：狀態快照從未產生',
      body: '快照 cron（/api/cron/snapshot）還沒有成功跑過任何一次，交接事件與「新交接」篩選都不會有資料。',
      payload: { baseline: null },
    };
  }

  const ageHours = (Date.now() - new Date(baseline.fetchedAt).getTime()) / 3_600_000;
  if (ageHours <= STALE_HOURS) return null;

  return {
    kind: 'snapshot_stale',
    subject: `OHCA Dashboard：狀態快照已 ${Math.round(ageHours)} 小時未更新`,
    body: `最後一次成功快照是 ${baseline.fetchedAt}。快照停擺時，畫面看起來與「大家都沒進度」一模一樣——請檢查 /api/cron/snapshot 的執行記錄與 REDCap 連線。`,
    payload: { baselineFetchedAt: baseline.fetchedAt, ageHours: Math.round(ageHours) },
  };
}

async function checkScans(): Promise<Alert | null> {
  const now = taipeiNow();
  // Before the deadline a missing file is just a morning; say nothing.
  if (now.getHours() < 9 + SCAN_GRACE_HOURS) return null;

  const today = taipeiDateString(now);
  const month = today.slice(0, 7);
  const { blobs } = await list({ prefix: `screening/${month}/` });

  // The sites are whatever has uploaded this month — self-adapting, so a new
  // scraper starts being watched by existing, and a retired one stops.
  const seenSites = new Set<string>();
  const todaySites = new Set<string>();
  for (const blob of blobs) {
    const base = blob.pathname.split('/').pop() ?? '';
    if (!base.endsWith('.json') || base.endsWith('_reviews.json')) continue;
    const name = base.slice(0, -5);
    const sep = name.indexOf('__');
    const date = sep > 0 ? name.slice(0, sep) : name;
    const site = sep > 0 ? name.slice(sep + 2) : '(單一檔)';
    seenSites.add(site);
    if (date === today) todaySites.add(site);
  }

  if (seenSites.size === 0) return null; // month just started; nothing to compare against
  const missing = [...seenSites].filter(site => !todaySites.has(site)).sort();
  if (missing.length === 0) return null;

  return {
    kind: 'scan_missing',
    subject: `OHCA Dashboard：今日 scraper 檔案缺 ${missing.length} 個院區`,
    body: `今天（${today}）到 ${String(now.getHours()).padStart(2, '0')}:00 為止，這些院區還沒有上傳掃描檔：${missing.join('、')}。已上傳：${[...todaySites].sort().join('、') || '（無）'}。補救方式是院內手動重跑 scraper。`,
    payload: { date: today, missing, uploaded: [...todaySites].sort() },
  };
}

/** The operator's address: the first active manager in the registry, else the sender itself. */
async function alertRecipient(): Promise<{ personId: string | null; email: string } | null> {
  if (hasDatabase()) {
    try {
      const people = await listPeople();
      const manager = people.find(p => p.roles.includes('manager') && p.email);
      if (manager) return { personId: manager.id, email: manager.email };
    } catch {
      // fall through to the mailbox itself
    }
  }
  const self = process.env.GMAIL_USER;
  return self ? { personId: null, email: self } : null;
}

export async function GET(request: Request) {
  if (!(await authorizeCron(request))) {
    return NextResponse.json({ error: '未授權' }, { status: 401 });
  }

  try {
    const results: Record<string, string> = {};
    const alerts = (await Promise.all([checkBaseline(), checkScans()]))
      .filter((alert): alert is Alert => alert !== null);

    if (alerts.length === 0) {
      return NextResponse.json({ ok: true, alerts: {} });
    }

    const recipient = await alertRecipient();
    const transporter = createTransporter();

    for (const alert of alerts) {
      if (await alreadySentToday(alert.kind)) {
        results[alert.kind] = 'already-sent-today';
        continue;
      }
      if (!recipient) {
        results[alert.kind] = 'no-recipient';
        console.error(`watchdog: ${alert.kind} triggered but GMAIL_USER is unset`, alert.payload);
        continue;
      }

      const mailId = await recordMailAttempt({
        toPersonId: recipient.personId,
        toEmail: recipient.email,
        kind: alert.kind,
        payload: alert.payload,
        requestedBy: null,
      });

      if (!transporter) {
        await markMailFailed(mailId, 'GMAIL_USER / GMAIL_APP_PASSWORD 未設定');
        results[alert.kind] = 'no-transporter';
        continue;
      }

      try {
        await transporter.sendMail({
          from: process.env.GMAIL_USER,
          to: recipient.email,
          subject: alert.subject,
          html: `<div style="font-family: -apple-system, 'Noto Sans TC', sans-serif; line-height: 1.6;"><p>${escapeHtml(alert.body)}</p></div>`,
        });
        await markMailSent(mailId);
        results[alert.kind] = `sent to ${recipient.email}`;
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError);
        await markMailFailed(mailId, message);
        results[alert.kind] = `send failed: ${message}`;
      }
    }

    return NextResponse.json({ ok: true, alerts: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('cron/watchdog failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
