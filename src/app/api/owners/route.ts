import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCached, setCached } from '@/lib/cache';
import { fetchUsers } from '@/lib/redcap/client';
import { getAssignments, setAssignments, getHiddenForms, setHiddenForms, getTargetIds, setTargetIds } from '@/lib/owner-store';
import type { TargetIds } from '@/lib/owner-store';
import type { User, OwnerAssignments } from '@/types';

const USERS_CACHE_KEY = 'redcap_users';

async function getUsers(): Promise<User[]> {
  const cached = getCached<User[]>(USERS_CACHE_KEY);
  if (cached) return cached;

  const raw = await fetchUsers();
  const users: User[] = raw.map(u => ({
    username: u.username,
    name: `${u.lastname}${u.firstname}`,
  }));

  setCached(USERS_CACHE_KEY, users, 1800);
  return users;
}

export async function GET() {
  try {
    const [users, assignments, hiddenForms, targetIds] = await Promise.all([
      getUsers(),
      getAssignments(),
      getHiddenForms(),
      getTargetIds(),
    ]);
    return NextResponse.json({ users, assignments, hiddenForms, targetIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    // Verify admin auth
    const cookieStore = await cookies();
    const token = cookieStore.get('admin_token')?.value;
    const adminPw = process.env.ADMIN_PASSWORD || '';
    const data = `${adminPw}-ohca-admin-salt`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash |= 0;
    }
    const expected = Math.abs(hash).toString(36);
    if (!adminPw || !token || token !== expected) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const body: { assignments?: OwnerAssignments; hiddenForms?: string[]; targetIds?: TargetIds } = await request.json();
    if (body.assignments !== undefined) {
      await setAssignments(body.assignments);
    }
    if (body.hiddenForms !== undefined) {
      await setHiddenForms(body.hiddenForms);
    }
    if (body.targetIds !== undefined) {
      await setTargetIds(body.targetIds);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
