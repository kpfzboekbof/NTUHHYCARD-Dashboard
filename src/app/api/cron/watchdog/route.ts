import { list } from '@vercel/blob';
import { runCronJob } from '@/lib/cron/run';
import { baselineStatus } from '@/lib/state/baseline';
import { listPeople } from '@/lib/people/repo';
import { hasDatabase } from '@/lib/db/client';
import { createTransporter, escapeHtml } from '@/lib/mailer';
import { alreadySentToday, recordMailAttempt, markMailFailed, markMailSent } from '@/lib/db/outbound-mail';
import { isTaipeiWeekend } from '@/lib/deadline';

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
  // The metadata probe, not the baseline itself: this only needs a timestamp,
  // and downloading a megabyte to inflate seventeen for it would be absurd.
  // It also separates "there is none" from "the store did not answer", which
  // the full read cannot — that one collapsed both into a mail claiming the
  // cron had never run, on days when the cron was fine and Blob was down.
  const status = await baselineStatus();
  if (status.exists === null) return null;

  if (!status.exists) {
    return {
      kind: 'snapshot_stale',
      subject: 'OHCA Dashboard：狀態快照從未產生',
      body: '快照 cron（/api/cron/snapshot）還沒有成功跑過任何一次，交接事件與「新交接」篩選都不會有資料。到 /admin/system 可以看執行紀錄，或直接按「立刻執行」建立第一份基準線。',
      payload: { baseline: null },
    };
  }

  const writtenAt = status.uploadedAt!;
  const ageHours = (Date.now() - new Date(writtenAt).getTime()) / 3_600_000;
  if (ageHours <= STALE_HOURS) return null;

  return {
    kind: 'snapshot_stale',
    subject: `OHCA Dashboard：狀態快照已 ${Math.round(ageHours)} 小時未更新`,
    body: `最後一次成功快照是 ${writtenAt}。快照停擺時，畫面看起來與「大家都沒進度」一模一樣——到 /admin/system 看執行紀錄，那裡會說它是失敗、被砍掉，還是根本沒有被觸發。`,
    payload: { baselineWrittenAt: writtenAt, ageHours: Math.round(ageHours) },
  };
}

async function checkScans(): Promise<Alert | null> {
  // The scrapers do not run at weekends. Two Saturday-and-Sunday alerts went
  // out before this line existed, each announcing that nothing had been
  // uploaded on a day nothing was ever going to be.
  if (isTaipeiWeekend()) return null;

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

/**
 * Where system alerts go: the system's own mailbox, or ALERT_EMAIL when set.
 *
 * This used to pick "the first active manager in the registry", which is the
 * first manager alphabetically — and the day a second manager was added, two
 * days of alerts went to a colleague instead of the operator. Alphabetical
 * order is not a definition of who runs the system; the mailbox the system
 * sends from is. The registry is consulted only to attach a person id to the
 * ledger row when that address belongs to somebody in it.
 */
async function alertRecipient(): Promise<{ personId: string | null; email: string } | null> {
  const email = process.env.ALERT_EMAIL || process.env.GMAIL_USER;
  if (!email) return null;

  let personId: string | null = null;
  if (hasDatabase()) {
    try {
      const match = (await listPeople()).find(p => p.email.toLowerCase() === email.toLowerCase());
      personId = match?.id ?? null;
    } catch {
      // A ledger without a person id is still a ledger.
    }
  }
  return { personId, email };
}

export async function GET(request: Request) {
  return runCronJob('watchdog', request, async () => {
    const results: Record<string, string> = {};
    const alerts = (await Promise.all([checkBaseline(), checkScans()]))
      .filter((alert): alert is Alert => alert !== null);

    if (alerts.length === 0) {
      return { ok: true, result: { alerts: {} } };
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

    return { ok: true, result: { alerts: results } };
  });
}
