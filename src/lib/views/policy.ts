/**
 * The freshness rules for a derived view, kept pure so they can be tested
 * without a database or a request context.
 */

export type Freshness =
  /** Within the window: serve it and say nothing. */
  | 'fresh'
  /** Older than the window: serve it, and get a rebuild going behind the response. */
  | 'stale'
  /** A write since the build made it suspect: whether to block on a rebuild is the view's call. */
  | 'invalidated';

export interface FreshnessInput {
  /** ISO timestamp of the build being served — when its export began. */
  fetchedAt: string;
  /**
   * ISO timestamp of an invalidation the build has not absorbed, or null.
   *
   * Presence is the whole signal. The store clears this when a build that
   * started after the invalidation lands, and keeps it when the invalidation
   * arrived while a build was already running — that build's export may
   * predate the write. Comparing timestamps here again would get the second
   * case wrong: such a build finishes after the write and would look current.
   */
  invalidatedAt: string | null;
  freshSeconds: number;
  /** Milliseconds since the epoch. */
  now: number;
}

export function assessFreshness(input: FreshnessInput): Freshness {
  if (input.invalidatedAt !== null) return 'invalidated';
  const fetched = Date.parse(input.fetchedAt);
  if (Number.isNaN(fetched)) return 'stale';
  return input.now - fetched > input.freshSeconds * 1000 ? 'stale' : 'fresh';
}

/**
 * Whether a refresh lease is still held.
 *
 * A rebuild that the platform killed at its time limit never releases its
 * lease, so a lease is only a lease for `leaseSeconds`; after that anyone may
 * claim it again.
 */
export function leaseActive(refreshStartedAt: string | null, leaseSeconds: number, now: number): boolean {
  if (refreshStartedAt === null) return false;
  const started = Date.parse(refreshStartedAt);
  if (Number.isNaN(started)) return false;
  return now - started < leaseSeconds * 1000;
}

/**
 * Whether an invalidation that arrived while a build was running must
 * outlive that build: it does when the write came after the export began.
 */
export function invalidationSurvivesBuild(invalidatedAt: string | null, buildStartedAt: string): string | null {
  if (invalidatedAt === null) return null;
  const invalidated = Date.parse(invalidatedAt);
  const started = Date.parse(buildStartedAt);
  if (Number.isNaN(invalidated) || Number.isNaN(started)) return invalidatedAt;
  return invalidated > started ? invalidatedAt : null;
}
