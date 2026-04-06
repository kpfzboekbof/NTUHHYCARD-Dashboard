import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { setLabelers } from '@/lib/labelers';

export async function POST(request: NextRequest) {
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
