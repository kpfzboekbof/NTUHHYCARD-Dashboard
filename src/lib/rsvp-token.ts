import { createHash } from 'node:crypto';

/**
 * Signs the (labelerCode, meetingDate) tuple so RSVP links from the email
 * can be opened by anyone with the link without going through the user-level
 * login, while still preventing trivial forgery from outsiders.
 *
 * The secret is derived from ADMIN_PASSWORD; if it isn't set the link will
 * still work locally but the signature is effectively public — that mirrors
 * how the existing admin/user tokens behave when the env var is missing.
 */
const RSVP_SALT = '-ohca-rsvp-salt-v1';

function secret(): string {
  return `${process.env.ADMIN_PASSWORD || ''}${RSVP_SALT}`;
}

export function signRsvp(labelerCode: number, meetingDate: string): string {
  return createHash('sha256')
    .update(`${labelerCode}|${meetingDate}|${secret()}`)
    .digest('hex')
    .slice(0, 32);
}

export function verifyRsvp(labelerCode: number, meetingDate: string, sig: string): boolean {
  if (!sig) return false;
  const expected = signRsvp(labelerCode, meetingDate);
  // Constant-time-ish comparison
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}
