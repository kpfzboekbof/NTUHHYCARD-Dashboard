import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ADMIN_COOKIE_NAME, expectedAdminToken, legacyAuthEnabled } from '@/lib/auth';
import { resolveIdentity } from '@/lib/auth/identity';
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

    if (!legacyAuthEnabled()) {
      return NextResponse.json(
        { error: '共用密碼已停用，請改用 email 登入連結' },
        { status: 410 },
      );
    }

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
  const identity = await resolveIdentity();
  const authenticated = !!identity && satisfiesRole(identity.roles, 'manager');
  return NextResponse.json({ authenticated });
}

/**
 * Sign out.
 *
 * Drops the individual session as well as the shared admin cookie — otherwise
 * 登出 does nothing at all for someone who signed in with a magic link. That
 * makes the button mean two different things depending on how you signed in,
 * so the answer says which happened: `sessionCleared` means the caller is now
 * signed out of the whole dashboard and should go to /login, rather than sit on
 * a page it can no longer load.
 */
export async function DELETE() {
  const jar = await cookies();
  const sessionCleared = !!jar.get(SESSION_COOKIE_NAME)?.value;

  const response = NextResponse.json({ ok: true, sessionCleared });
  response.cookies.delete(TOKEN_NAME);
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
