/**
 * Shared auth helpers for both auth layers, kept edge-safe (no next/headers)
 * so `src/proxy.ts` can import from here:
 *
 *  - user-level (site-wide) login: USER_PASSWORD + `user_token` cookie
 *  - admin-level login: ADMIN_PASSWORD + `admin_token` cookie
 *
 * Route handlers that need to read the admin cookie should use
 * `isAdminRequest()` from `@/lib/admin-auth` instead of re-deriving tokens.
 *
 * The hashing used below is a 32-bit DJB2-style hash. It is NOT a
 * cryptographically secure MAC; it only defends against casual URL access.
 * Do not reuse for anything stronger without upgrading both layers together.
 */

export const USER_COOKIE_NAME = 'user_token';
export const ADMIN_COOKIE_NAME = 'admin_token';
const USER_SALT = '-ohca-user-salt';
const ADMIN_SALT = '-ohca-admin-salt';

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/** Expected user_token cookie value for the current USER_PASSWORD. */
export function expectedUserToken(): string | null {
  const pw = process.env.USER_PASSWORD || '';
  if (!pw) return null;
  return hashString(`${pw}${USER_SALT}`);
}

/** Check a provided token value against the expected one. Edge-safe. */
export function isValidUserToken(token: string | undefined | null): boolean {
  const expected = expectedUserToken();
  if (!expected || !token) return false;
  return token === expected;
}

/** Expected admin_token cookie value for the current ADMIN_PASSWORD. */
export function expectedAdminToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD || '';
  if (!pw) return null;
  return hashString(`${pw}${ADMIN_SALT}`);
}

/** Check a provided admin token value against the expected one. Edge-safe. */
export function isValidAdminToken(token: string | undefined | null): boolean {
  const expected = expectedAdminToken();
  if (!expected || !token) return false;
  return token === expected;
}
