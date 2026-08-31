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
import { hasDatabase } from '@/lib/db/client';
import { findById } from '@/lib/people/repo';
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
  /** Display name when known; the shared-password identity has none. */
  displayName: string | null;
  /** How this should be recorded in `audit_log`. */
  actor: Actor;
  /** True when the request arrived on a shared password. */
  legacy: boolean;
}

/** Machine callers (scraper, PA weekly report) act as their token, not a person. */
export function tokenIdentity(tokenName: string, roles: Role[] = ['manager']): Identity {
  return { personId: null, roles, displayName: tokenName, actor: { tokenName }, legacy: false };
}

/** How this identity should be shown to a human, and stored beside a decision. */
export function identityLabel(identity: Identity): string {
  if (identity.displayName) return identity.displayName;
  return 'tokenName' in identity.actor ? identity.actor.tokenName : identity.actor.personId;
}

/**
 * The identity behind the current request, or null when unauthenticated.
 *
 * Credentials add up rather than shadow each other. Someone who signed in with
 * a magic link as a viewer and then typed the shared admin password on an admin
 * page holds both, and expects the admin page to work — an early return on the
 * session cookie would silently ignore the password they just typed.
 */
export async function getIdentity(): Promise<Identity | null> {
  const jar = await cookies();

  const sharedAdmin = isValidAdminToken(jar.get(ADMIN_COOKIE_NAME)?.value);

  const session = verifySessionToken(jar.get(SESSION_COOKIE_NAME)?.value);
  if (session) {
    const roles = sharedAdmin && !session.roles.includes('manager')
      ? [...session.roles, 'manager' as Role]
      : session.roles;
    return {
      personId: session.personId,
      roles,
      displayName: null,
      actor: { personId: session.personId },
      legacy: false,
    };
  }

  if (sharedAdmin) {
    return {
      personId: null,
      roles: ['manager'],
      displayName: null,
      actor: { tokenName: 'legacy-shared-admin' },
      legacy: true,
    };
  }

  if (isValidUserToken(jar.get(USER_COOKIE_NAME)?.value)) {
    return {
      personId: null,
      roles: ['viewer'],
      displayName: null,
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
  const identity = await resolveIdentity();
  if (!identity) {
    return { ok: false, response: NextResponse.json({ error: '未登入' }, { status: 401 }) };
  }
  if (!satisfiesRole(identity.roles, required)) {
    return { ok: false, response: NextResponse.json({ error: '權限不足' }, { status: 403 }) };
  }
  return { ok: true, identity };
}

/**
 * The identity with its roles taken from the person row rather than the cookie.
 *
 * A session token is valid for 30 days, so roles baked into it are a promise
 * about the past: deactivating someone or taking away their manager role would
 * otherwise change nothing until their cookie expired. The proxy stays
 * optimistic and signature-only — as the Next.js docs ask — and this is where
 * the database has the last word.
 *
 * A shared-password identity has no row to read, and is returned unchanged.
 */
export async function resolveIdentity(): Promise<Identity | null> {
  const identity = await getIdentity();
  if (!identity?.personId || !hasDatabase()) return identity;

  const person = await findById(identity.personId);
  // Deleted or deactivated since the token was issued: the token is no longer
  // a credential, whatever it still says inside.
  if (!person || !person.active) return null;

  // A shared admin password still adds manager on top of what the row says.
  const roles = identity.roles.includes('manager') && !person.roles.includes('manager')
    ? [...person.roles, 'manager' as Role]
    : person.roles;

  return { ...identity, roles, displayName: person.displayName };
}
