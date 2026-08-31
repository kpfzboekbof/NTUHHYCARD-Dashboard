import { getSql, newId } from '@/lib/db/client';
import { packToken, unpackToken } from './signing';

/**
 * Magic-link tokens: signed, short-lived, and single-use.
 *
 * A signature alone cannot make a link single-use. The link sits in a mailbox
 * for its whole validity window, so anyone who later reads that mailbox — or a
 * forwarded copy of it — can sign in again. `login_token` is what makes
 * redemption a fact rather than an assertion: the row is claimed by one
 * `UPDATE … WHERE used_at IS NULL`, so two simultaneous clicks cannot both win.
 */

const PURPOSE = 'login';
export const LOGIN_TOKEN_TTL_SECONDS = 15 * 60;

interface LoginPayload {
  jti: string;
  /** Unix seconds. Checked here and again in SQL, which is the authority. */
  exp: number;
}

/** Issues a link token for a person, recording the jti so it can be spent. */
export async function createLoginToken(
  personId: string,
  ttlSeconds: number = LOGIN_TOKEN_TTL_SECONDS,
): Promise<string> {
  const jti = newId();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const token = packToken(PURPOSE, { jti, exp: Math.floor(expiresAt.getTime() / 1000) });
  if (!token) throw new Error('SESSION_SECRET 未設定：無法簽發登入連結');

  const sql = getSql();
  await sql`
    INSERT INTO login_token (jti, person_id, expires_at)
    VALUES (${jti}, ${personId}, ${expiresAt.toISOString()})
  `;
  return token;
}

/**
 * Spends a token, returning the person it belongs to — or null if the
 * signature is wrong, it has expired, or it has already been used.
 *
 * The claim is one statement so concurrent redemptions cannot both succeed.
 */
export async function redeemLoginToken(token: string | undefined): Promise<string | null> {
  const payload = unpackToken<LoginPayload>(PURPOSE, token);
  if (!payload || typeof payload.jti !== 'string') return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;

  const sql = getSql();
  const rows = await sql`
    UPDATE login_token
       SET used_at = now()
     WHERE jti = ${payload.jti}
       AND used_at IS NULL
       AND expires_at > now()
    RETURNING person_id
  `;
  return rows.length ? (rows[0] as { person_id: string }).person_id : null;
}

/**
 * Drops spent and expired rows. Nothing depends on them once used — the audit
 * trail records the sign-in, not the token.
 */
export async function pruneLoginTokens(): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    DELETE FROM login_token
     WHERE expires_at < now() - interval '7 days'
    RETURNING jti
  `;
  return rows.length;
}
