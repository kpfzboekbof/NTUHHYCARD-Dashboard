import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { hasDatabase } from '@/lib/db/client';
import { ALL_ROLES, type Role } from '@/lib/auth/session';
import {
  createPerson, listPeople, updatePerson, type PersonInput,
} from '@/lib/people/repo';

/**
 * The people registry — manager only.
 *
 * This is where the three identity systems get tied together: a REDCap
 * username, an etiology labeler code and a login email on one row. The labeler
 * code in particular has no other home; REDCap knows the code, and only a human
 * knows which person it belongs to.
 */

export const runtime = 'nodejs';

function noDatabase() {
  return NextResponse.json(
    { error: '未設定 OHCA_DATABASE_URL：人員登記表無法使用' },
    { status: 503 },
  );
}

function parseRoles(value: unknown): Role[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const roles = value.filter((r): r is Role => ALL_ROLES.includes(r as Role));
  // An empty role list would leave someone signed in but unable to view
  // anything, which reads as a bug rather than a decision.
  return roles.length > 0 ? Array.from(new Set(roles)) : undefined;
}

export async function GET(request: Request) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;
  if (!hasDatabase()) return noDatabase();

  try {
    const includeInactive = new URL(request.url).searchParams.get('includeInactive') === '1';
    const people = await listPeople(includeInactive);
    return NextResponse.json({ people });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Add someone REDCap does not know about — a PA, or a labeler with no account. */
export async function POST(request: Request) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;
  if (!hasDatabase()) return noDatabase();

  try {
    const body = await request.json();
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!displayName || !email) {
      return NextResponse.json({ error: '姓名與 email 為必填' }, { status: 400 });
    }

    const input: PersonInput = {
      displayName,
      email,
      redcapUsername: typeof body.redcapUsername === 'string' && body.redcapUsername.trim()
        ? body.redcapUsername.trim()
        : null,
      labelerCode: Number.isInteger(body.labelerCode) ? body.labelerCode : null,
      roles: parseRoles(body.roles) ?? ['viewer'],
    };

    const person = await createPerson(input, auth.identity.actor);
    return NextResponse.json({ person });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Edit one person. The id travels in the body rather than the path so this
 * route needs no generated route types to typecheck.
 */
export async function PATCH(request: Request) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;
  if (!hasDatabase()) return noDatabase();

  try {
    const body = await request.json();
    if (typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    const changes: Partial<PersonInput> = {};
    if (typeof body.displayName === 'string') changes.displayName = body.displayName.trim();
    if (typeof body.email === 'string') changes.email = body.email.trim();
    if (body.redcapUsername !== undefined) {
      changes.redcapUsername = typeof body.redcapUsername === 'string' && body.redcapUsername.trim()
        ? body.redcapUsername.trim()
        : null;
    }
    if (body.labelerCode !== undefined) {
      changes.labelerCode = Number.isInteger(body.labelerCode) ? body.labelerCode : null;
    }
    const roles = parseRoles(body.roles);
    if (roles) changes.roles = roles;
    if (typeof body.broadcastOptOut === 'boolean') changes.broadcastOptOut = body.broadcastOptOut;
    if (typeof body.notifyPref === 'string') changes.notifyPref = body.notifyPref;
    if (typeof body.active === 'boolean') changes.active = body.active;

    const person = await updatePerson(body.id, changes, auth.identity.actor);
    return NextResponse.json({ person });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
