import type { Role } from './roles';
import { packToken, unpackToken } from './signing';

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

export { ALL_ROLES, ROLE_LABELS, satisfiesRole, type Role } from './roles';

export interface SessionPayload {
  personId: string;
  roles: Role[];
  /** Unix seconds. */
  exp: number;
}

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The `purpose` that keeps a session cookie distinct from a login link. */
const PURPOSE = 'session';

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
  const token = packToken(PURPOSE, payload);
  if (!token) throw new Error('SESSION_SECRET 未設定：無法簽發登入 session');
  return token;
}

/**
 * Returns the payload, or null when the token is malformed, forged or expired.
 *
 * A missing SESSION_SECRET verifies nothing, so it rejects rather than throws:
 * this runs in the proxy on every request, and an unset secret should lock the
 * new login out, not take the whole site down.
 */
export function verifySessionToken(
  token: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  const payload = unpackToken<SessionPayload>(PURPOSE, token);
  if (!payload) return null;

  if (typeof payload.personId !== 'string' || !Array.isArray(payload.roles)) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;

  return payload;
}

export function hasRole(payload: SessionPayload | null, role: Role): boolean {
  return !!payload?.roles.includes(role);
}

