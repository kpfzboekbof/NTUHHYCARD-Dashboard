import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { getUsers } from '@/lib/redcap/service';
import { getAssignments, setAssignments, getHiddenForms, setHiddenForms, getTargetIds, setTargetIds } from '@/lib/owner-store';
import { getLabelers, setLabelers } from '@/lib/labelers';
import type { Labeler } from '@/lib/redcap/etiology-transform';
import type { TargetIds } from '@/lib/owner-store';
import type { OwnerAssignments } from '@/types';

export async function GET() {
  try {
    const [users, assignments, hiddenForms, targetIds, labelers] = await Promise.all([
      getUsers(),
      getAssignments(),
      getHiddenForms(),
      getTargetIds(),
      getLabelers(),
    ]);
    return NextResponse.json({ users, assignments, hiddenForms, targetIds, labelers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    if (!(await isAdminRequest())) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const body: { assignments?: OwnerAssignments; hiddenForms?: string[]; targetIds?: TargetIds; labelers?: Labeler[] } = await request.json();
    if (body.assignments !== undefined) {
      await setAssignments(body.assignments);
    }
    if (body.hiddenForms !== undefined) {
      await setHiddenForms(body.hiddenForms);
    }
    if (body.targetIds !== undefined) {
      await setTargetIds(body.targetIds);
    }
    if (body.labelers !== undefined) {
      await setLabelers(body.labelers);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
