import { headers } from 'next/headers';
import * as nodemailer from 'nodemailer';

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

/** Resolve the public base URL used to build links inside emails. */
export async function resolveBaseUrl(): Promise<string> {
  const explicit = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`;
  // Fall back to the inbound request's host so dev and self-hosted setups
  // still produce a clickable link.
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    const proto = h.get('x-forwarded-proto') || 'http';
    if (host) return `${proto}://${host}`;
  } catch {}
  return 'http://localhost:3000';
}
