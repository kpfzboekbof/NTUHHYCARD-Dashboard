/**
 * Shared auth helpers for the user-level (site-wide) login.
 *
 * Note: the admin-level auth (ADMIN_PASSWORD + admin_token cookie) lives
 * inline in `src/app/api/auth/route.ts` and several API routes — it is
 * intentionally not touched here to minimise blast radius.
 *
 * The hashing used below is the same 32-bit DJB2-style hash already used
 * by the admin auth. It is NOT a cryptographically secure MAC; it only
 * defends against casual URL access. Do not reuse for anything stronger
 * without upgrading both layers together.
 */

export const USER_COOKIE_NAME = 'user_token';
const USER_SALT = '-ohca-user-salt';

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
  if (!legacyAuthEnabled()) return false;
  const expected = expectedUserToken();
  if (!expected || !token) return false;
  return token === expected;
}

/* ------------------------------------------------------------------ *
 * Admin-level shared password.
 *
 * The same DJB2 token, previously re-derived inline in five places
 * (api/auth, api/owners, api/etiology, api/qc/fix, api/etiology-reminder)
 * — each copy its own chance to drift. It lives here so the migration to
 * individual identity has one legacy path to delete, not five.
 * ------------------------------------------------------------------ */

export const ADMIN_COOKIE_NAME = 'admin_token';
const ADMIN_SALT = '-ohca-admin-salt';

/** Expected admin_token cookie value for the current ADMIN_PASSWORD. */
export function expectedAdminToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD || '';
  if (!pw) return null;
  return hashString(`${pw}${ADMIN_SALT}`);
}

export function isValidAdminToken(token: string | undefined | null): boolean {
  if (!legacyAuthEnabled()) return false;
  const expected = expectedAdminToken();
  if (!expected || !token) return false;
  return token === expected;
}

/**
 * Whether the shared-password cookies are still honoured.
 *
 * Set `LEGACY_AUTH=off` once everyone has signed in with a magic link at
 * least once; the DJB2 path then stops being an accepted credential and can
 * be deleted outright.
 */
export function legacyAuthEnabled(): boolean {
  return (process.env.LEGACY_AUTH || '').toLowerCase() !== 'off';
}
