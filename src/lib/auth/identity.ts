import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  satisfiesRole,
  verifySessionToken,
  type Role,
} from './session';
import {
  ADMIN_COOKIE_NAME,
  USER_COOKIE_NAME,
  isValidAdminToken,
  isValidUserToken,
} from '@/lib/auth';
import type { Actor } from '@/lib/db/audit';

/**
 * Who is making this request, and may they do the thing they are asking for.
 *
 * One module answers both questions. Before this, the admin check was written
 * out by hand in five route handlers and the user check lived in the proxy, so
 * "is this person allowed" had six independent answers and none of them named
 * an individual.
 *
 * Two credentials are accepted during the migration:
 *
 *  - the `session` cookie, naming a person and their roles;
 *  - the legacy shared-password cookies, which name nobody. They map to a
 *    synthetic `legacy-shared` identity so existing users keep working on day
 *    one, and so an audit row can at least say the change came in through the
 *    shared password rather than silently claiming a person did it.
 *
 * Set `LEGACY_AUTH=off` to drop the second path once everyone has signed in.
 */

export interface Identity {
  /** Null when the request arrived on a shared password. */
  personId: string | null;
  roles: Role[];
  /** How this should be recorded in `audit_log`. */
  actor: Actor;
  /** True when the request arrived on a shared password. */
  legacy: boolean;
}

/** Machine callers (scraper, PA weekly report) act as their token, not a person. */
export function tokenIdentity(tokenName: string, roles: Role[] = ['manager']): Identity {
  return { personId: null, roles, actor: { tokenName }, legacy: false };
}

/** The identity behind the current request, or null when unauthenticated. */
export async function getIdentity(): Promise<Identity | null> {
  const jar = await cookies();

  const session = verifySessionToken(jar.get(SESSION_COOKIE_NAME)?.value);
  if (session) {
    return {
      personId: session.personId,
      roles: session.roles,
      actor: { personId: session.personId },
      legacy: false,
    };
  }

  // The admin cookie is the stronger of the two legacy credentials, so it is
  // checked first: a user holding both should not be demoted to viewer.
  if (isValidAdminToken(jar.get(ADMIN_COOKIE_NAME)?.value)) {
    return {
      personId: null,
      roles: ['manager'],
      actor: { tokenName: 'legacy-shared-admin' },
      legacy: true,
    };
  }

  if (isValidUserToken(jar.get(USER_COOKIE_NAME)?.value)) {
    return {
      personId: null,
      roles: ['viewer'],
      actor: { tokenName: 'legacy-shared-user' },
      legacy: true,
    };
  }

  return null;
}

export type RoleCheck =
  | { ok: true; identity: Identity }
  | { ok: false; response: NextResponse };

/**
 * Guard for a route handler. Returns the response to send on failure rather
 * than throwing, so a handler reads as a straight line:
 *
 *     const auth = await requireRole('manager');
 *     if (!auth.ok) return auth.response;
 */
export async function requireRole(required: Role): Promise<RoleCheck> {
  const identity = await getIdentity();
  if (!identity) {
    return { ok: false, response: NextResponse.json({ error: '未登入' }, { status: 401 }) };
  }
  if (!satisfiesRole(identity.roles, required)) {
    return { ok: false, response: NextResponse.json({ error: '權限不足' }, { status: 403 }) };
  }
  return { ok: true, identity };
}
