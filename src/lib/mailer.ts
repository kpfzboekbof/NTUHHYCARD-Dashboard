import { headers } from 'next/headers';
import * as nodemailer from 'nodemailer';

// Re-exported for callers already inside a request; the definition lives in
// mail/escape so body builders can be tested without Next.
export { escapeHtml } from './mail/escape';

/**
 * The one outbound mail channel and the one way to work out this app's public
 * URL, shared by the etiology reminder and the login link.
 *
 * A link that is wrong in a login email is worse than one that is wrong in a
 * reminder: the reminder can be re-sent, the login link is the only way in.
 */

/** Null when Gmail credentials are absent — callers decide whether that is fatal. */
export function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

/**
 * The base URL from configuration alone — never from the request.
 *
 * Null when nothing is configured. Use this for anything that grants access
 * when clicked: an inbound `X-Forwarded-Host` is attacker-controlled, so
 * deriving a login link from it lets someone else's host receive a genuine,
 * unspent sign-in token for a real clinician.
 */
export function configuredBaseUrl(): string | null {
  const explicit = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`;
  return null;
}

/**
 * The public base URL for links inside emails, falling back to the inbound
 * request's host so dev and self-hosted setups still produce a clickable link.
 *
 * Only for links where a wrong host is cosmetic — a reminder can be re-sent.
 * Anything that carries a credential must use `configuredBaseUrl()`.
 */
export async function resolveBaseUrl(): Promise<string> {
  const configured = configuredBaseUrl();
  if (configured) return configured;
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    const proto = h.get('x-forwarded-proto') || 'http';
    if (host) return `${proto}://${host}`;
  } catch {}
  return 'http://localhost:3000';
}
