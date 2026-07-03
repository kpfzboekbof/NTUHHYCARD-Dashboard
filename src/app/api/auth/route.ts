import { NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME, expectedAdminToken } from '@/lib/auth';
import { isAdminRequest } from '@/lib/admin-auth';

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const adminPw = process.env.ADMIN_PASSWORD || '';

    if (!adminPw) {
      return NextResponse.json({ error: '未設定 ADMIN_PASSWORD 環境變數' }, { status: 500 });
    }

    if (password !== adminPw) {
      return NextResponse.json({ error: '密碼錯誤' }, { status: 401 });
    }

    const token = expectedAdminToken()!;
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return response;
  } catch {
    return NextResponse.json({ error: '登入失敗' }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ authenticated: await isAdminRequest() });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ADMIN_COOKIE_NAME);
  return response;
}
