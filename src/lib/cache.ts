import NodeCache from 'node-cache';
import { getRedis, redisEnabled } from '@/lib/redis';

/**
 * Small-value cache: REDCap users, the data-dictionary lookups, the deep-link
 * base. Memory first (per instance), Redis behind it on Vercel so a fresh
 * instance does not have to ask REDCap again.
 *
 * The heavy derived views (completion, state matrix, etiology, …) no longer
 * live here — see src/lib/views. Those are persisted in Postgres and served
 * stale while they refresh in the background; this cache is for values small
 * enough that recomputing them on a miss is cheap.
 *
 * `useClones: false` — node-cache deep-copies values on every get and set by
 * default, which for a multi-megabyte object costs more than the lookup it
 * guards. Nothing that reads from here mutates what it gets back.
 */
const memCache = new NodeCache({ stdTTL: 300, useClones: false });

export function getCached<T>(key: string): T | undefined {
  return memCache.get<T>(key);
}

export async function getCachedAsync<T>(key: string): Promise<T | undefined> {
  const mem = memCache.get<T>(key);
  if (mem !== undefined) return mem;

  if (redisEnabled()) {
    try {
      const redis = await getRedis();
      if (redis) {
        const raw = await redis.get(`cache:${key}`);
        if (raw) {
          const data = JSON.parse(raw) as T;
          const ttl = await redis.ttl(`cache:${key}`).catch(() => -1);
          // Warm the memory tier for the remainder of the Redis lifetime, so a
          // value cached for a day does not get re-read from Redis every five
          // minutes but also does not outlive it.
          memCache.set(key, data, ttl > 0 ? ttl : 300);
          return data;
        }
      }
    } catch {
      // Redis unavailable, continue without it
    }
  }
  return undefined;
}

export function setCached<T>(key: string, data: T, ttl?: number): void {
  const seconds = ttl ?? 300;
  memCache.set(key, data, seconds);

  // Also store in Redis (fire-and-forget, don't await). A rejected write is
  // logged with its size: a value over the provider's request limit fails
  // every time, and silently would look exactly like a cache that works.
  if (redisEnabled()) {
    const raw = JSON.stringify(data);
    getRedis().then(redis => {
      if (redis) return redis.set(`cache:${key}`, raw, 'EX', seconds);
    }).catch(error => {
      console.error(`cache: Redis write of ${key} (${Buffer.byteLength(raw)} bytes) failed`, error);
    });
  }
}

/** Drop one key from both tiers. */
export function deleteCached(key: string): void {
  memCache.del(key);
  if (redisEnabled()) {
    getRedis().then(redis => redis?.del(`cache:${key}`)).catch(() => {});
  }
}

export function clearAllCache(): void {
  memCache.flushAll();

  // Clear Redis cache keys too
  if (redisEnabled()) {
    getRedis().then(async redis => {
      if (!redis) return;
      const keys = await redis.keys('cache:*');
      if (keys.length > 0) await redis.del(...keys);
    }).catch(() => {});
  }
}
