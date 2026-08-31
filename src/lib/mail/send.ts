import { createTransporter } from '@/lib/mailer';
import { recordMailAttempt, markMailSent, markMailFailed } from '@/lib/db/outbound-mail';

/**
 * The one way this system sends mail to a human.
 *
 * Every path goes through here so the ledger cannot have holes: the attempt is
 * written before the send and the outcome after, which means a crash mid-send
 * leaves "attempted, unconfirmed" rather than silence. The old consensus
 * reminder wrote a single global `reminderSentAt` that was updated even when
 * every recipient failed — this exists so that cannot happen again.
 *
 * Never throws for a send failure: the caller decides whether a failed
 * recipient aborts a batch (it should not) or is reported (it must be).
 */

export interface TrackedMail {
  toPersonId: string | null;
  toEmail: string;
  /** nudge | batch_due | meeting_reminder | scan_missing | snapshot_stale | login_link */
  kind: string;
  subject: string;
  html: string;
  text?: string;
  /** Recorded in the ledger; what this mail was about, not its full body. */
  payload: unknown;
  /** The person who pressed the button; null for scheduled work. */
  requestedBy: string | null;
}

export interface SendResult {
  ok: boolean;
  toEmail: string;
  error?: string;
}

export async function sendTrackedMail(mail: TrackedMail): Promise<SendResult> {
  const mailId = await recordMailAttempt({
    toPersonId: mail.toPersonId,
    toEmail: mail.toEmail,
    kind: mail.kind,
    payload: mail.payload,
    requestedBy: mail.requestedBy,
  });

  const transporter = createTransporter();
  if (!transporter) {
    const error = 'GMAIL_USER / GMAIL_APP_PASSWORD 未設定';
    await markMailFailed(mailId, error);
    return { ok: false, toEmail: mail.toEmail, error };
  }

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: mail.toEmail,
      subject: mail.subject,
      html: mail.html,
      ...(mail.text ? { text: mail.text } : {}),
    });
  } catch (sendError) {
    const error = sendError instanceof Error ? sendError.message : String(sendError);
    await markMailFailed(mailId, error);
    return { ok: false, toEmail: mail.toEmail, error };
  }

  await markMailSent(mailId);
  return { ok: true, toEmail: mail.toEmail };
}

/** Taipei wall-clock, for anything a human will read. */
export function taipeiTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
