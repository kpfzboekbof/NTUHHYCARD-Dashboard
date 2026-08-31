import { NextResponse } from 'next/server';
import { hasDatabase } from '@/lib/db/client';
import { findById } from '@/lib/people/repo';
import { redeemLoginToken } from '@/lib/auth/login-token';
import { recordAudit } from '@/lib/db/audit';
import { safeInternalPath } from '@/lib/safe-path';
import {
  SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, createSessionToken,
} from '@/lib/auth/session';

/**
 * GET /api/auth/callback?token=… — spend a login link and start a session.
 *
 * Redirects either way, because this URL is opened from a mail client: an
 * error page a person can read beats a JSON body they cannot.
 */

export const runtime = 'nodejs';

function toLogin(request: Request, reason: string) {
  const url = new URL('/login', request.url);
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? undefined;

  if (!hasDatabase()) return toLogin(request, 'no-database');

  try {
    const personId = await redeemLoginToken(token);
    // One message for expired, already-used and forged: which one it was is
    // not something the person clicking can act on differently.
    if (!personId) return toLogin(request, 'link-invalid');

    const person = await findById(personId);
    if (!person || !person.active) return toLogin(request, 'inactive');

    const response = NextResponse.redirect(new URL(safeInternalPath(url.searchParams.get('next')), request.url));
    response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(person.id, person.roles), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });

    // Deliberately non-fatal. The token has already been spent by the time we
    // get here, so throwing would burn a single-use link and hand back no
    // session — the person would be locked out with no way to sign in.
    await recordAudit({
      actor: { personId: person.id },
      action: 'login_link.redeem',
      entityType: 'person',
      entityId: person.id,
    });

    return response;
  } catch (error) {
    console.error('auth callback failed:', error);
    return toLogin(request, 'error');
  }
}

/** Sign out: drop the session cookie. The legacy cookies have their own routes. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
