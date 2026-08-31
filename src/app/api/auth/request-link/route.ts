import { NextResponse } from 'next/server';
import { hasDatabase } from '@/lib/db/client';
import { findByEmail } from '@/lib/people/repo';
import { createLoginToken, LOGIN_TOKEN_TTL_SECONDS } from '@/lib/auth/login-token';
import { createTransporter, resolveBaseUrl } from '@/lib/mailer';
import { writeAudit } from '@/lib/db/audit';

/**
 * POST /api/auth/request-link — email someone a sign-in link.
 *
 * Always answers 204, whatever happened. Any other shape of answer turns this
 * endpoint into a way to ask "does this person have an account here", and the
 * roster is a list of named clinicians.
 *
 * Failures are therefore logged server-side and swallowed; the person who
 * genuinely owns the address finds out by not receiving mail, and asks.
 */

export const runtime = 'nodejs';

const NO_CONTENT = new NextResponse(null, { status: 204 });

function loginEmail(link: string, displayName: string) {
  const minutes = Math.round(LOGIN_TOKEN_TTL_SECONDS / 60);
  return {
    subject: 'OHCA Dashboard 登入連結',
    text: [
      `${displayName} 您好，`,
      '',
      `請點下面的連結登入 OHCA Dashboard（${minutes} 分鐘內有效，只能使用一次）：`,
      link,
      '',
      '如果不是您本人要求登入，請忽略這封信；沒有人可以用這封信以外的方式取得連結。',
    ].join('\n'),
    html: `
      <div style="font-family: -apple-system, 'Noto Sans TC', sans-serif; line-height: 1.6;">
        <p>${displayName} 您好，</p>
        <p>請點下面的按鈕登入 OHCA Dashboard（${minutes} 分鐘內有效，<strong>只能使用一次</strong>）：</p>
        <p>
          <a href="${link}"
             style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;
                    border-radius:6px;text-decoration:none;">登入 OHCA Dashboard</a>
        </p>
        <p style="color:#666;font-size:13px;">
          按鈕無法點擊時，請複製這個網址：<br>${link}
        </p>
        <p style="color:#666;font-size:13px;">
          如果不是您本人要求登入，請忽略這封信。
        </p>
      </div>
    `,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!email || !hasDatabase()) return NO_CONTENT;

    // Where they were headed when the proxy sent them to /login. Only
    // same-site paths survive; the callback checks again before redirecting.
    const next = typeof body.next === 'string' && body.next.startsWith('/') && !body.next.startsWith('//')
      ? body.next
      : null;

    const person = await findByEmail(email);
    if (!person || !person.active) return NO_CONTENT;

    const transporter = createTransporter();
    if (!transporter) {
      console.error('request-link: GMAIL_USER / GMAIL_APP_PASSWORD 未設定，無法寄送登入連結');
      return NO_CONTENT;
    }

    const token = await createLoginToken(person.id);
    const baseUrl = await resolveBaseUrl();
    const link = `${baseUrl}/api/auth/callback?token=${encodeURIComponent(token)}`
      + (next ? `&next=${encodeURIComponent(next)}` : '');
    const mail = loginEmail(link, person.displayName);

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: person.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    // The request is the auditable event: a link was issued for this person.
    // Whether it was redeemed is a separate row written by the callback.
    await writeAudit({
      actor: { tokenName: 'auth' },
      action: 'login_link.request',
      entityType: 'person',
      entityId: person.id,
    });

    return NO_CONTENT;
  } catch (error) {
    console.error('request-link failed:', error);
    return NO_CONTENT;
  }
}
