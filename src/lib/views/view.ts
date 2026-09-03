import { AsyncLocalStorage } from 'node:async_hooks';
import { assessFreshness, invalidationSurvivesBuild, leaseActive } from './policy';
import * as durable from './store';
import { REDCAP_EXPORT_LOCK, type LeaseToken } from './store';

/**
 * Derived views: answer from the last build, rebuild behind the response.
 *
 * Every heavy page in this dashboard is a view derived from a REDCap export
 * that takes between ten seconds and a minute. The old cache held each view
 * for five minutes and then forgot it, so with one operator nearly every visit
 * after a short pause ran the export in the foreground, in front of a spinner.
 *
 * A view is now served from whatever build exists — memory on this instance,
 * else the durable tier — and the request only waits for REDCap when there is
 * nothing at all to show, when the caller insists (the 重新抓取 button,
 * `force`), when the caller needs data younger than a bound (`maxAgeSeconds`,
 * for mail that names a real person), or when the view was invalidated by a
 * write and says `onInvalidate: 'rebuild'`.
 *
 * Past its freshness window a view is still served, marked `stale`, and one
 * rebuild is scheduled with Next's `after()` so it runs once the response has
 * gone out.
 *
 * REDCap gets one export at a time. The server has been measured falling
 * from a one-minute export to ten when two run side by side, so builds that
 * export are serialised on this instance (a gate) and across instances (a
 * lease on a row that stands for REDCap). A foreground build that finds the
 * lease held answers with what it has, marked refreshing, rather than start
 * a second export; the client polls and picks up the build that is running.
 *
 * Writes that make a snapshot wrong (etiology_final, a QC fix, a settings
 * change) call `invalidateViews` for the views they touch — not a global
 * flush — and each view decides whether that means "refresh soon" or
 * "rebuild before answering".
 */

export interface ViewContext {
  /** The caller asked for REDCap to be consulted now; pass it to any view this one reads. */
  force: boolean;
}

export interface ViewDefinition<T> {
  key: string;
  /** How long a build is served without asking for a fresher one. */
  freshSeconds: number;
  /**
   * What an invalidation means. `refresh` (default): keep serving, rebuild in
   * the background. `rebuild`: the next read waits for a fresh build — for a
   * view whose reader is about to act on its own write. A `rebuild` view
   * also consults the durable tier on every read, so a write handled by
   * another instance is seen at once.
   */
  onInvalidate?: 'refresh' | 'rebuild';
  /**
   * Whether the build exports from REDCap. Such builds go through the REDCap
   * gate and lease; a build composed from other views does not, and must not
   * wait on one.
   */
  exportsFromRedcap?: boolean;
  /** How long a background rebuild may hold its lease before it is presumed dead. */
  leaseSeconds?: number;
  /**
   * How often this instance's memory copy is compared against the durable
   * tier, which another instance may have refreshed or invalidated. Zero means
   * every read; `rebuild` views are always zero.
   */
  recheckSeconds?: number;
  /**
   * Views built from this one. When a build of this view lands they are
   * invalidated, so a composed view never keeps reporting numbers from an
   * input that has since moved on.
   */
  dependents?: string[];
  build: (ctx: ViewContext) => Promise<T>;
}

export function defineView<T>(definition: ViewDefinition<T>): ViewDefinition<T> {
  return definition;
}

export interface ViewResult<T> {
  data: T;
  /** When the export behind this build began. */
  fetchedAt: string;
  /** Older than the freshness window, or invalidated. */
  stale: boolean;
  /** A rebuild is running (here or on another instance); a later read may be newer. */
  refreshing: boolean;
  /** Background rebuilds keep dying; only 重新抓取 will move this view now. */
  refreshFailed: boolean;
  source: 'memory' | 'store' | 'built';
}

export interface ReadOptions {
  /** Rebuild now, whatever exists. */
  force?: boolean;
  /**
   * Rebuild now if what exists is older than this. For callers about to act
   * on the data — a reminder mail names a person and lists their work.
   */
  maxAgeSeconds?: number;
}

interface MemoryEntry {
  data: unknown;
  fetchedAt: string;
  invalidatedAt: string | null;
  refreshStartedAt: string | null;
  refreshAttempts: number;
  /** When this copy was last compared against the durable tier. */
  checkedAt: number;
}

/**
 * Matches the `maxDuration` every view route declares: a lease shorter than
 * the function budget would let a second export start while the first is
 * still legitimately running.
 */
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_RECHECK_SECONDS = 30;
/** Background claims without a landed build before the view gives up on the background. */
const MAX_BACKGROUND_ATTEMPTS = 3;

/**
 * The durable tier, swappable so the read/refresh logic can be tested with an
 * in-memory stand-in instead of Postgres and Blob.
 */
export type DurableStore = Pick<typeof durable,
  'readStoredView' | 'readViewHead' | 'writeStoredView' | 'claimLease' | 'releaseLease' | 'invalidateStoredViews'
>;
let store: DurableStore = durable;
const { readStoredView, readViewHead, writeStoredView, claimLease, releaseLease, invalidateStoredViews } = {
  readStoredView: <T,>(key: string) => store.readStoredView<T>(key),
  readViewHead: (key: string) => store.readViewHead(key),
  writeStoredView: (key: string, data: unknown, fetchedAt: string) => store.writeStoredView(key, data, fetchedAt),
  claimLease: (key: string, leaseSeconds: number, countAttempt: boolean) => store.claimLease(key, leaseSeconds, countAttempt),
  releaseLease: (key: string, token: LeaseToken) => store.releaseLease(key, token),
  invalidateStoredViews: (keys: string[], at: string) => store.invalidateStoredViews(keys, at),
};

/** Per instance. Vercel keeps instances warm between requests, so this is a real cache, not a request cache. */
const memory = new Map<string, MemoryEntry>();
/** Builds running on this instance, so concurrent readers share one. */
const inflight = new Map<string, Promise<ViewResult<unknown>>>();
/**
 * Invalidations this instance has seen, by view — kept apart from `memory`
 * because a write can land while a view's first build is still running and
 * there is no memory entry yet to mark.
 */
const invalidations = new Map<string, string>();

/**
 * What a finished build owes: an invalidation this instance saw, or one
 * another instance wrote, when either came after the export began.
 */
function outstandingInvalidation(key: string, fetchedAt: string, fromStore: string | null): string | null {
  const local = invalidationSurvivesBuild(invalidations.get(key) ?? null, fetchedAt);
  if (local === null) invalidations.delete(key);
  return local ?? invalidationSurvivesBuild(fromStore, fetchedAt);
}

/* ------------------------------------------------------------------ *
 * The REDCap gate: one exporting build at a time on this instance.
 *
 * Reentrant through the async context, so a build that reads another view
 * (QC reads completion and the log) does not wait on itself when that view
 * has to build too.
 * ------------------------------------------------------------------ */

const insideGate = new AsyncLocalStorage<true>();
let gateTail: Promise<void> = Promise.resolve();

async function throughRedcapGate<R>(fn: () => Promise<R>): Promise<R> {
  if (insideGate.getStore()) return fn();
  const previous = gateTail;
  let release!: () => void;
  gateTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    return await insideGate.run(true, fn);
  } finally {
    release();
  }
}

/* ------------------------------------------------------------------ *
 * Deferring work past the response: Next's `after()` in the app, replaced
 * in tests. Loaded lazily so this module stays importable — and testable —
 * outside a Next.js server.
 * ------------------------------------------------------------------ */

type Scheduler = (job: () => Promise<void>) => void | Promise<void>;
let scheduler: Scheduler | null = null;

async function schedule(job: () => Promise<void>): Promise<void> {
  if (!scheduler) {
    try {
      const { after } = await import('next/server');
      scheduler = task => after(task);
    } catch {
      scheduler = task => { void task(); };
    }
  }
  try {
    await scheduler(job);
  } catch {
    // Outside a request scope `after` throws; run detached instead.
    void job();
  }
}

/* ------------------------------------------------------------------ */

function leaseFor<T>(view: ViewDefinition<T>): number {
  return view.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
}

function recheckMsFor<T>(view: ViewDefinition<T>): number {
  if ((view.onInvalidate ?? 'refresh') === 'rebuild') return 0;
  return (view.recheckSeconds ?? DEFAULT_RECHECK_SECONDS) * 1000;
}

function entryFromStored(stored: NonNullable<Awaited<ReturnType<typeof readStoredView>>>, now: number): MemoryEntry {
  return {
    data: stored.data,
    fetchedAt: stored.fetchedAt,
    invalidatedAt: stored.invalidatedAt,
    refreshStartedAt: stored.refreshStartedAt,
    refreshAttempts: stored.refreshAttempts,
    checkedAt: now,
  };
}

type Found = { entry: MemoryEntry; source: 'memory' | 'store' };

/**
 * The best copy we have: memory if it was checked recently, otherwise the
 * durable tier — which may hold a newer build from another instance.
 */
async function current(view: ViewDefinition<unknown>, now: number): Promise<Found | null> {
  const mem = memory.get(view.key);
  if (mem && now - mem.checkedAt < recheckMsFor(view)) return { entry: mem, source: 'memory' };

  if (!mem) {
    const stored = await readStoredView<unknown>(view.key);
    if (!stored) return null;
    const entry = entryFromStored(stored, now);
    memory.set(view.key, entry);
    return { entry, source: 'store' };
  }

  // Memory holds a copy; ask the durable tier only whether it has moved on.
  const head = await readViewHead(view.key);
  mem.checkedAt = now;
  if (head?.fetchedAt && Date.parse(head.fetchedAt) > Date.parse(mem.fetchedAt)) {
    const stored = await readStoredView<unknown>(view.key);
    if (stored) {
      const entry = entryFromStored(stored, now);
      memory.set(view.key, entry);
      return { entry, source: 'store' };
    }
  }
  if (head) {
    mem.invalidatedAt = head.invalidatedAt;
    mem.refreshStartedAt = head.refreshStartedAt;
    mem.refreshAttempts = head.refreshAttempts;
  }
  return { entry: mem, source: 'memory' };
}

interface RebuildOptions {
  force: boolean;
  /** Leases held by a background refresh; released if the build fails. */
  leases?: Array<{ key: string; token: LeaseToken }>;
}

/**
 * Run the view's build once, however many readers are waiting on it.
 *
 * Except from inside the gate: a build that is already queued for this view
 * is waiting for the gate the caller holds, and joining it would wait for
 * ever. The nested build runs now; the queued one runs later and lands the
 * same result — a duplicate export in a case (two first-ever builds at the
 * same instant) rare enough to prefer over a deadlock.
 */
function rebuild<T>(view: ViewDefinition<T>, options: RebuildOptions): Promise<ViewResult<T>> {
  const running = inflight.get(view.key);
  if (running && !insideGate.getStore()) return running as Promise<ViewResult<T>>;

  const produce = async () => {
    // The export's start is the data's age — an invalidation after this
    // instant is about something this build may not have seen. Taken inside
    // the gate, so time spent queued behind another export does not count.
    const fetchedAt = new Date().toISOString();
    const data = await view.build({ force: options.force });
    return { data, fetchedAt };
  };

  let run!: Promise<ViewResult<T>>;
  run = (async (): Promise<ViewResult<T>> => {
    try {
      const { data, fetchedAt } = view.exportsFromRedcap
        ? await throughRedcapGate(produce)
        : await produce();

      const written = await writeStoredView(view.key, data, fetchedAt);
      const entry: MemoryEntry = {
        data,
        fetchedAt,
        invalidatedAt: outstandingInvalidation(view.key, fetchedAt, written.invalidatedAt),
        refreshStartedAt: null,
        refreshAttempts: 0,
        checkedAt: Date.now(),
      };
      memory.set(view.key, entry);
      if (view.dependents?.length) await invalidateViews(view.dependents);
      return { data, fetchedAt, stale: entry.invalidatedAt !== null, refreshing: false, refreshFailed: false, source: 'built' };
    } catch (error) {
      for (const lease of options.leases ?? []) await releaseLease(lease.key, lease.token);
      throw error;
    } finally {
      if (inflight.get(view.key) === run) inflight.delete(view.key);
    }
  })();

  inflight.set(view.key, run as Promise<ViewResult<unknown>>);
  return run;
}

/**
 * Hold the REDCap lease around an export that does not go through a view —
 * the snapshot cron. Best effort: the cron runs whether or not it gets the
 * lease, but while it holds it no background rebuild starts an export beside
 * it.
 */
export async function holdingRedcapLease<R>(fn: () => Promise<R>): Promise<R> {
  const token = await claimLease(REDCAP_EXPORT_LOCK, DEFAULT_LEASE_SECONDS, false);
  try {
    return await fn();
  } finally {
    if (token) await releaseLease(REDCAP_EXPORT_LOCK, token);
  }
}

function fromEntry<T>(found: Found, stale: boolean, refreshing: boolean, refreshFailed = false): ViewResult<T> {
  return {
    data: found.entry.data as T,
    fetchedAt: found.entry.fetchedAt,
    stale,
    refreshing,
    refreshFailed,
    source: found.source,
  };
}

/**
 * A build the request waits for.
 *
 * A top-level exporting build takes the REDCap lease so it never runs beside
 * a background export on another instance. If that lease is held, the
 * request gets what exists, marked refreshing — the running export will land
 * and the client's polling will pick it up — unless there is nothing to give,
 * in which case the build goes ahead regardless.
 */
async function foreground<T>(view: ViewDefinition<T>, force: boolean, have: Found | null): Promise<ViewResult<T>> {
  if (!view.exportsFromRedcap || insideGate.getStore()) return rebuild(view, { force });

  const token = await claimLease(REDCAP_EXPORT_LOCK, leaseFor(view), false);
  if (!token) {
    const found = have ?? await current(view, Date.now());
    if (found) return fromEntry<T>(found, true, true);
    return rebuild(view, { force });
  }
  try {
    return await rebuild(view, { force });
  } finally {
    await releaseLease(REDCAP_EXPORT_LOCK, token);
  }
}

/**
 * Schedule a background rebuild after the current response.
 *
 * The leases are taken inside the deferred job, not before the response:
 * a request should not pay a round trip to arrange work it will not wait for.
 */
async function scheduleRefresh<T>(view: ViewDefinition<T>): Promise<void> {
  if (inflight.has(view.key)) return;
  const lease = leaseFor(view);

  await schedule(async () => {
    // A foreground build on this instance (somebody pressed 重新抓取, or a
    // meeting is waiting on its own write) outranks background work.
    if (inflight.size > 0) return;

    const token = await claimLease(view.key, lease, true);
    if (!token) return; // another instance is already on it
    const leases = [{ key: view.key, token }];

    if (view.exportsFromRedcap) {
      const redcap = await claimLease(REDCAP_EXPORT_LOCK, lease, false);
      if (!redcap) {
        // REDCap is busy with another view's export. Give the view lease
        // back so the next read can try again once that one has landed.
        await releaseLease(view.key, token);
        return;
      }
      leases.push({ key: REDCAP_EXPORT_LOCK, token: redcap });
    }

    try {
      await rebuild(view, { force: false, leases });
    } catch (error) {
      // The leases were released in rebuild; the next read will try again,
      // and the attempt counter is what stops it trying for ever.
      console.error(`views: background refresh of ${view.key} failed`, error);
      return;
    }
    if (view.exportsFromRedcap) await releaseLease(REDCAP_EXPORT_LOCK, leases[1].token);
  });
}

/**
 * Read a view. See the module comment for when this waits for REDCap.
 */
export async function readView<T>(view: ViewDefinition<T>, options: ReadOptions = {}): Promise<ViewResult<T>> {
  if (options.force) return foreground(view, true, null);

  const now = Date.now();
  const found = await current(view, now);
  if (!found) return foreground(view, false, null);

  const { entry } = found;
  const ageSeconds = (now - Date.parse(entry.fetchedAt)) / 1000;
  if (options.maxAgeSeconds !== undefined && !(ageSeconds <= options.maxAgeSeconds)) {
    // Too old for what the caller is about to do with it; that outranks the
    // stale-while-revalidate contract, and a failure here is the caller's.
    return rebuild(view, { force: false });
  }

  const refreshing = inflight.has(view.key) || leaseActive(entry.refreshStartedAt, leaseFor(view), now);
  const freshness = assessFreshness({
    fetchedAt: entry.fetchedAt,
    invalidatedAt: entry.invalidatedAt,
    freshSeconds: view.freshSeconds,
    now,
  });

  if (freshness === 'fresh') return fromEntry<T>(found, false, refreshing);

  if (freshness === 'invalidated' && (view.onInvalidate ?? 'refresh') === 'rebuild') {
    try {
      return await foreground(view, false, found);
    } catch (error) {
      // REDCap did not answer. The old snapshot beats an error page; it is
      // marked stale so the screen says so.
      console.error(`views: rebuild of ${view.key} failed, serving the previous build`, error);
      return fromEntry<T>(found, true, false);
    }
  }

  if (refreshing) return fromEntry<T>(found, true, true);

  if (entry.refreshAttempts >= MAX_BACKGROUND_ATTEMPTS) {
    // Every background attempt has died without landing — almost always the
    // platform's time limit. Say so rather than promise an update that never
    // comes; the operator's 重新抓取 runs in the foreground and resets this.
    return fromEntry<T>(found, true, false, true);
  }

  await scheduleRefresh(view);
  return fromEntry<T>(found, true, true);
}

/**
 * Put a build that was produced elsewhere (the snapshot cron) where readers
 * will find it, so the first page load after the cron pays nothing.
 * `fetchedAt` is when that build's export began.
 */
export async function storeView<T>(view: ViewDefinition<T>, data: T, fetchedAt: string): Promise<void> {
  const written = await writeStoredView(view.key, data, fetchedAt);
  memory.set(view.key, {
    data,
    fetchedAt,
    invalidatedAt: outstandingInvalidation(view.key, fetchedAt, written.invalidatedAt),
    refreshStartedAt: null,
    refreshAttempts: 0,
    checkedAt: Date.now(),
  });
  if (view.dependents?.length) await invalidateViews(view.dependents);
}

/**
 * Mark views as suspect after a write. Scoped, not global: an etiology_final
 * write has no bearing on the QC view, and the old `clearAllCache` also threw
 * away the state matrix — a minute of REDCap — on every save of a consensus
 * meeting.
 */
export async function invalidateViews(keys: string[]): Promise<void> {
  const at = new Date().toISOString();
  for (const key of keys) {
    invalidations.set(key, at);
    const entry = memory.get(key);
    if (entry) entry.invalidatedAt = at;
  }
  await invalidateStoredViews(keys, at);
}

/** The response body for a view: its data with the freshness fields on top. */
export function viewPayload<T extends object>(result: ViewResult<T>): T & {
  fetchedAt: string; stale: boolean; refreshing: boolean; refreshFailed: boolean;
} {
  return {
    ...result.data,
    fetchedAt: result.fetchedAt,
    stale: result.stale,
    refreshing: result.refreshing,
    refreshFailed: result.refreshFailed,
  };
}

/**
 * For tests: forget everything this instance holds, and optionally swap in a
 * scheduler and a durable tier.
 */
export function resetViewsForTests(options: { scheduler?: Scheduler | null; store?: DurableStore } = {}): void {
  memory.clear();
  inflight.clear();
  invalidations.clear();
  scheduler = options.scheduler ?? null;
  store = options.store ?? durable;
}
