import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { USER_COOKIE_NAME, isValidUserToken } from '@/lib/auth';

/**
 * Site-wide user-level gate.
 *
 * Next.js 16 renamed `middleware` → `proxy`. See
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
 *
 * This proxy requires a valid `user_token` cookie for every request that
 * reaches the `matcher` below. It does NOT touch the admin-level auth —
 * API routes and pages that need admin rights continue to check the
 * `admin_token` cookie themselves.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(USER_COOKIE_NAME)?.value;

  if (isValidUserToken(token)) {
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
  //  - /login                (the login page itself)
  //  - /api/user-auth        (the endpoint the login page POSTs to)
  //  - /_next/static, /_next/image  (build assets)
  //  - /favicon.ico          (icon)
  //  - any file with an extension (images, fonts, etc. in /public)
  matcher: [
    '/((?!login|api/user-auth|_next/static|_next/image|favicon\\.ico|.*\\..*).*)',
  ],
};
