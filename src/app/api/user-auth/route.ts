import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { USER_COOKIE_NAME, expectedUserToken, isValidUserToken } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const userPw = process.env.USER_PASSWORD || '';

    if (!userPw) {
      return NextResponse.json({ error: '未設定 USER_PASSWORD 環境變數' }, { status: 500 });
    }

    if (password !== userPw) {
      return NextResponse.json({ error: '密碼錯誤' }, { status: 401 });
    }

    const token = expectedUserToken();
    if (!token) {
      return NextResponse.json({ error: '無法產生登入權杖' }, { status: 500 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(USER_COOKIE_NAME, token, {
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
  const cookieStore = await cookies();
  const token = cookieStore.get(USER_COOKIE_NAME)?.value;
  return NextResponse.json({ authenticated: isValidUserToken(token) });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(USER_COOKIE_NAME);
  return response;
}
