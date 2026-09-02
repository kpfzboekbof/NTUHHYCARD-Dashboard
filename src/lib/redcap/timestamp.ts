/**
 * REDCap log timestamps, read in the timezone REDCap actually wrote them in.
 *
 * The log is stamped in project-local time with no zone marker. The project is
 * in Taipei, which has had no DST since 1980, so the offset is a constant — and
 * stating it beats `new Date(...)`, which reads the same string as the server's
 * local time and lands eight hours out on a UTC host, moving saves across day
 * and activity-window boundaries.
 *
 * Its own module because both the state engine and the legacy transform need
 * it, and neither should have to import the other to get it.
 */

const TAIPEI_OFFSET = '+08:00';
const LOCAL_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

export function parseRedcapTimestamp(raw: string | undefined): Date | null {
  if (!raw) return null;
  const match = LOCAL_TIMESTAMP.exec(raw.trim());
  const parsed = match
    ? new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}${TAIPEI_OFFSET}`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The Taipei calendar day (YYYY-MM-DD) a moment falls on. */
export function taipeiDay(at: Date): string {
  return at.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}
