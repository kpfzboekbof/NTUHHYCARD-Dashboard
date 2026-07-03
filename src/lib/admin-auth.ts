import { cookies } from 'next/headers';
import { ADMIN_COOKIE_NAME, isValidAdminToken } from './auth';

/**
 * Whether the current request carries a valid `admin_token` cookie.
 *
 * This is the single admin gate for route handlers — the token derivation
 * itself lives in `@/lib/auth` (edge-safe). Kept in a separate module because
 * `next/headers` cannot be imported from `src/proxy.ts`.
 */
export async function isAdminRequest(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAdminToken(cookieStore.get(ADMIN_COOKIE_NAME)?.value);
}
