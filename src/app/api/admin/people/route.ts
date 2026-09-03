import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { hasDatabase } from '@/lib/db/client';
import { ALL_ROLES, type Role } from '@/lib/auth/session';
import {
  createPerson, listPeople, updatePerson, type PersonInput,
} from '@/lib/people/repo';
import { invalidateViews } from '@/lib/views/view';
import { VIEW } from '@/lib/views/keys';

/**
 * The people registry — manager only.
 *
 * One row ties a person's identities together: a REDCap username, a login
 * email and, when they review etiology, that form's labeler code. Only a human
 * knows which person a code belongs to, so somewhere has to record it.
 *
 * `labelerCode` is writable here but is not edited on /admin/people: that page
 * is the project roster and one form's dropdown is not its business. The link
 * is made on /etiology beside the labelers it names, through this same PATCH,
 * so the person row stays the single place it is stored.
 */

export const runtime = 'nodejs';

function noDatabase() {
  return NextResponse.json(
    { error: '未設定 OHCA_DATABASE_URL：人員登記表無法使用' },
    { status: 503 },
  );
}

/**
 * `undefined` means "not supplied"; an empty array means the caller sent roles
 * that are all invalid or none at all, which is refused rather than dropped —
 * silently ignoring it answers 200 while changing nothing.
 */
function parseRoles(value: unknown): Role[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const roles = value.filter((r): r is Role => ALL_ROLES.includes(r as Role));
  return Array.from(new Set(roles));
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
    if (input.roles && input.roles.length === 0) {
      return NextResponse.json({ error: '至少要給一個角色' }, { status: 400 });
    }

    const person = await createPerson(input, auth.identity.actor);
    // The owners page joins people in at build time.
    await invalidateViews([VIEW.ownersProgress]);
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
    // Empty is refused, not stored: `updatePerson` treats '' as a real value
    // (it is not nullish), so a blanked email would silently destroy the only
    // way that person can ever sign in.
    if (typeof body.displayName === 'string') {
      const displayName = body.displayName.trim();
      if (!displayName) return NextResponse.json({ error: '姓名不可為空' }, { status: 400 });
      changes.displayName = displayName;
    }
    if (typeof body.email === 'string') {
      const email = body.email.trim();
      if (!email) return NextResponse.json({ error: 'Email 不可為空' }, { status: 400 });
      changes.email = email;
    }
    if (body.redcapUsername !== undefined) {
      changes.redcapUsername = typeof body.redcapUsername === 'string' && body.redcapUsername.trim()
        ? body.redcapUsername.trim()
        : null;
    }
    if (body.labelerCode !== undefined) {
      changes.labelerCode = Number.isInteger(body.labelerCode) ? body.labelerCode : null;
    }
    const roles = parseRoles(body.roles);
    if (roles) {
      if (roles.length === 0) {
        return NextResponse.json({ error: '至少要給一個角色' }, { status: 400 });
      }
      changes.roles = roles;
    }
    if (typeof body.broadcastOptOut === 'boolean') changes.broadcastOptOut = body.broadcastOptOut;
    if (typeof body.notifyPref === 'string') changes.notifyPref = body.notifyPref;
    if (typeof body.active === 'boolean') changes.active = body.active;

    const person = await updatePerson(body.id, changes, auth.identity.actor);
    await invalidateViews([VIEW.ownersProgress]);
    return NextResponse.json({ person });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
