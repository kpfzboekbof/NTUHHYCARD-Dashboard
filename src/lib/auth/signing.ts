import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 over a compact payload, shared by everything this app signs
 * with `SESSION_SECRET`.
 *
 * The `purpose` string is mixed into the MAC so signatures cannot be moved
 * between uses: a 30-day session cookie must not be redeemable as a 15-minute
 * login link, and vice versa, even though both are signed with one secret.
 */

function secret(): string | null {
  return process.env.SESSION_SECRET || null;
}

/** Null when no secret is configured — nothing can be signed. */
export function signBody(purpose: string, body: string): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac('sha256', key).update(`${purpose}.${body}`).digest('base64url');
}

/** Constant-time comparison; a length mismatch alone is not a timing signal. */
export function verifyBody(purpose: string, body: string, signature: string): boolean {
  const expected = signBody(purpose, body);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function encodeBody(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeBody<T>(body: string): T | null {
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** `body.signature`, or null when there is no secret to sign with. */
export function packToken(purpose: string, value: unknown): string | null {
  const body = encodeBody(value);
  const signature = signBody(purpose, body);
  return signature === null ? null : `${body}.${signature}`;
}

/** The payload of a token whose signature checks out, else null. */
export function unpackToken<T>(purpose: string, token: string | undefined): T | null {
  if (!token) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  if (!verifyBody(purpose, body, token.slice(separator + 1))) return null;
  return decodeBody<T>(body);
}
