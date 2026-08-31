import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed session tokens carrying an individual's identity.
 *
 * The web tier previously had no individual identity at all: one shared
 * password for the site and one for admin actions, each hashed with a 32-bit
 * DJB2 loop the code itself flagged as insecure. Every screening decision,
 * every etiology write and every assignment change was therefore
 * unattributable. A session now names a person, so an audit row can too.
 *
 * HMAC-SHA256 over a compact JSON payload — no JWT library, because nothing
 * here needs more than "this payload came from us and has not expired".
 */

export type Role = 'manager' | 'doctor' | 'abstractor' | 'labeler' | 'viewer';

export const ALL_ROLES: Role[] = ['manager', 'doctor', 'abstractor', 'labeler', 'viewer'];

export interface SessionPayload {
  personId: string;
  roles: Role[];
  /** Unix seconds. */
  exp: number;
}

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error('SESSION_SECRET 未設定：無法簽發或驗證登入 session');
  return value;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

/** Constant-time comparison; a length mismatch alone is not a timing signal. */
function signatureMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createSessionToken(
  personId: string,
  roles: Role[],
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const payload: SessionPayload = {
    personId,
    roles,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Returns the payload, or null when the token is malformed, forged or expired. */
export function verifySessionToken(
  token: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!token) return null;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!signatureMatches(sign(body), signature)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload?.personId !== 'string' || !Array.isArray(payload.roles)) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;

  return payload;
}

export function hasRole(payload: SessionPayload | null, role: Role): boolean {
  return !!payload?.roles.includes(role);
}
