import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { setLabelers } from '@/lib/labelers';

export async function POST(request: NextRequest) {
  try {
    if (!(await isAdminRequest())) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const body = await request.json();
    if (Array.isArray(body.labelers)) {
      await setLabelers(body.labelers);
      return NextResponse.json({ ok: true, count: body.labelers.length });
    }
    return NextResponse.json({ error: 'labelers array required' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
