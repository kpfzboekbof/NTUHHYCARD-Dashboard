import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { USER_COOKIE_NAME, isValidUserToken } from '@/lib/auth';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session';

/**
 * Site-wide user-level gate.
 *
 * Next.js 16 renamed `middleware` → `proxy`. See
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
 *
 * Every request reaching the `matcher` below must carry either the `session`
 * cookie naming a person, or — while `LEGACY_AUTH` is on — the shared-password
 * `user_token`. This is an optimistic gate only, as the Next.js docs ask of a
 * proxy: it checks a signature, never the database. Anything that depends on
 * *which* person is asking calls `requireRole` in the route handler itself.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (session) {
    return NextResponse.next();
  }

  if (isValidUserToken(request.cookies.get(USER_COOKIE_NAME)?.value)) {
    return NextResponse.next();
  }

  // API requests get a JSON 401 so clients (SWR, fetch) handle it cleanly
  // rather than following an HTML redirect.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  // Page requests: redirect to /login and remember where the user came from.
  const loginUrl = new URL('/login', request.url);
  const from = pathname + request.nextUrl.search;
  if (from && from !== '/') {
    loginUrl.searchParams.set('from', from);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Match everything EXCEPT:
  //  - /login                      (the login page itself)
  //  - /api/user-auth              (the endpoint the login page POSTs to)
  //  - /api/auth/request-link      (magic-link request; the caller has no session yet)
  //  - /api/auth/callback          (magic-link redemption; sets the session)
  //  - /api/screening/upload       (scraper uploads via Bearer token, not cookie)
  //  - /api/rsvp                   (one-click RSVP from email; uses signed token)
  //  - /api/report/weekly          (PA 週報 routine reads via Bearer token, not cookie)
  //  - /_next/static, /_next/image (build assets)
  //  - /favicon.ico                (icon)
  //  - any file with an extension  (images, fonts, etc. in /public)
  matcher: [
    '/((?!login|api/user-auth|api/auth/request-link|api/auth/callback|api/screening/upload|api/rsvp|api/report/weekly|_next/static|_next/image|favicon\\.ico|.*\\..*).*)',
  ],
};
