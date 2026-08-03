import NodeCache from 'node-cache';
import { getRedis, withRedisRead, isRedisEnabled } from '@/lib/redis';

/**
 * In-memory cache (works for local dev, short-lived on Vercel).
 *
 * `useClones: false` is load-bearing, not a micro-optimisation. node-cache
 * deep-clones on every `get` AND every `set`; on the `completion` payload
 * (tens of thousands of rows) that measured ~800 ms at 62k rows and ~7 s at
 * 186k rows — of blocking CPU, on the cache *hit* path, paid again by
 * `/api/qc` and `/api/logging`.
 *
 * CONTRACT: values passed to `setCached` are immutable. Callers get the same
 * object back by reference and must not mutate it. The dev-only freeze below
 * turns a violation into a loud TypeError instead of silent cache corruption.
 */
const memCache = new NodeCache({ stdTTL: 300, useClones: false });

/** Freeze one level deep so `data.rows.push(...)` throws in dev. */
function guardImmutable<T>(data: T): void {
  if (process.env.NODE_ENV === 'production') return;
  if (!data || typeof data !== 'object') return;
  for (const value of Object.values(data as Record<string, unknown>)) {
    // Only the containers — deep-freezing every row would reintroduce the
    // very O(n) cost `useClones: false` just removed.
    if (Array.isArray(value)) Object.freeze(value);
  }
  Object.freeze(data);
}

export function getCached<T>(key: string): T | undefined {
  return memCache.get<T>(key);
}

export async function getCachedAsync<T>(key: string): Promise<T | undefined> {
  // Try memory first
  const mem = memCache.get<T>(key);
  if (mem) return mem;

  // Try Redis on Vercel
  if (isRedisEnabled) {
    const raw = await withRedisRead(redis => redis.get(`cache:${key}`));
    if (raw) {
      try {
        const data = JSON.parse(raw) as T;
        const ttl = await withRedisRead(redis => redis.ttl(`cache:${key}`));
        // Warm memory with the REMAINING Redis lifetime, not a fresh 300 s —
        // otherwise an entry can live up to 2x its intended TTL.
        if (typeof ttl === 'number' && ttl > 0) {
          guardImmutable(data);
          memCache.set(key, data, ttl);
        }
        return data;
      } catch (err) {
        console.error('[cache] failed to parse redis value', key, err);
      }
    }
  }
  return undefined;
}

/**
 * Writes memory synchronously (the handler must see its own write) and
 * returns a promise for the Redis leg. Route handlers should pass that
 * promise to `after()` from `next/server` so the response is not held open
 * but the write still completes before the instance is frozen.
 */
export function setCached<T>(key: string, data: T, ttl?: number): Promise<void> {
  const seconds = ttl ?? 300;
  guardImmutable(data);
  memCache.set(key, data, seconds);

  if (!isRedisEnabled) return Promise.resolve();

  return (async () => {
    try {
      const redis = await getRedis();
      if (!redis) return;
      const payload = JSON.stringify(data);
      if (payload.length > 5_000_000) {
        console.warn(`[cache] oversized value for "${key}": ${payload.length} bytes — ` +
          'this may exceed the Redis provider value cap and be rejected.');
      }
      await redis.set(`cache:${key}`, payload, 'EX', seconds);
    } catch (err) {
      // Previously this was swallowed by an empty catch that never even ran
      // (the promise had no .catch), so a permanently failing Redis tier was
      // indistinguishable from a working one.
      console.error('[cache] redis SET failed', key, err);
    }
  })();
}

/* ── Invalidation ───────────────────────────────────────── */

export const LOGGING_MONTHS = [1, 3, 6, 12] as const;

/** Every key this app writes, for the site-wide refresh endpoint. */
export const ALL_CACHE_KEYS: string[] = [
  'completion', 'qc', 'etiology', 'redcap_users',
  ...LOGGING_MONTHS.map(m => `logging_${m}`),
];

/**
 * Everything derived from the completion rows. Any REDCap write that can move
 * a form's completion status must drop all of these — `logging_*` byOwner
 * counts and the QC behaviour flags are both computed from those same rows.
 */
export const COMPLETION_DERIVED: string[] = [
  'completion', 'qc',
  ...LOGGING_MONTHS.map(m => `logging_${m}`),
];

/**
 * Drop specific keys. Awaited inline by callers — never deferred via
 * `after()`: on the self-hosted build memCache is the only cache layer, so a
 * deferred delete would open a stale window that does not exist today.
 */
export async function invalidate(keys: string[]): Promise<void> {
  for (const key of keys) memCache.del(key);
  if (!isRedisEnabled || keys.length === 0) return;
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.unlink(...keys.map(k => `cache:${k}`));
  } catch (err) {
    console.error('[cache] redis invalidate failed', keys, err);
  }
}

export async function clearAllCache(): Promise<void> {
  memCache.flushAll();
  await invalidate(ALL_CACHE_KEYS);
}

/* ── Single-flight ──────────────────────────────────────── */

const inflight = new Map<string, Promise<unknown>>();

/**
 * Collapse concurrent misses for the same key into one upstream load.
 *
 * Every open tab polls on the same 300 s interval as the server TTL, so they
 * all expire at the same instant and stampede REDCap together. This does not
 * change staleness at all — it only stops N identical whole-project exports
 * from running when one would do.
 */
export function singleFlight<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    try {
      return await loader();
    } finally {
      inflight.delete(key); // never cache a rejection
    }
  })();

  inflight.set(key, promise);
  return promise;
}
