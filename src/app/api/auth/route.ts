import { NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME, expectedAdminToken } from '@/lib/auth';
import { getIdentity } from '@/lib/auth/identity';
import { SESSION_COOKIE_NAME, satisfiesRole } from '@/lib/auth/session';

/**
 * The admin-level shared password.
 *
 * Kept working while people move onto individual logins: GET now answers for
 * either credential, so a manager who signed in with a magic link sees the
 * admin pages without also typing the shared password.
 */

const TOKEN_NAME = ADMIN_COOKIE_NAME;

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    if (!adminPassword) {
      return NextResponse.json({ error: '未設定 ADMIN_PASSWORD 環境變數' }, { status: 500 });
    }

    if (password !== adminPassword) {
      return NextResponse.json({ error: '密碼錯誤' }, { status: 401 });
    }

    const token = expectedAdminToken();
    if (!token) {
      return NextResponse.json({ error: '無法產生登入權杖' }, { status: 500 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(TOKEN_NAME, token, {
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
  const identity = await getIdentity();
  const authenticated = !!identity && satisfiesRole(identity.roles, 'manager');
  return NextResponse.json({ authenticated });
}

/**
 * Sign out. Drops the individual session too, not just the shared admin
 * cookie — otherwise 登出 does nothing at all for someone who signed in with a
 * magic link, which is worse than logging them out further than they expected.
 */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(TOKEN_NAME);
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
