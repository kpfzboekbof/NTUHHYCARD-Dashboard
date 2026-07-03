import NodeCache from 'node-cache';
import { connectRedis } from './kv-store';

// In-memory cache (works for local dev, short-lived on Vercel)
const memCache = new NodeCache({ stdTTL: 300 });

// Redis cache for Vercel (persistent across serverless invocations)
const isVercel = !!process.env.VERCEL;

async function getRedis() {
  if (!isVercel) return null;
  try {
    return await connectRedis({ connectTimeout: 3000 });
  } catch {
    return null;
  }
}

export function getCached<T>(key: string): T | undefined {
  return memCache.get<T>(key);
}

export async function getCachedAsync<T>(key: string): Promise<T | undefined> {
  // Try memory first
  const mem = memCache.get<T>(key);
  if (mem !== undefined) return mem;

  // Try Redis on Vercel
  if (isVercel) {
    let redis;
    try {
      redis = await getRedis();
      if (redis) {
        const raw = await redis.get(`cache:${key}`);
        if (raw) {
          const data = JSON.parse(raw) as T;
          memCache.set(key, data); // warm up memory cache
          return data;
        }
      }
    } catch {
      // Redis unavailable, continue without cache
    } finally {
      redis?.disconnect();
    }
  }
  return undefined;
}

export function setCached<T>(key: string, data: T, ttl?: number): void {
  const seconds = ttl ?? 300;
  memCache.set(key, data, seconds);

  // Also store in Redis (fire-and-forget, don't await)
  if (isVercel) {
    getRedis().then(redis => {
      if (redis) {
        redis.set(`cache:${key}`, JSON.stringify(data), 'EX', seconds)
          .finally(() => redis.disconnect());
      }
    }).catch(() => {});
  }
}

/**
 * Clear memory + Redis cache. Await this before refetching — the Redis
 * deletion used to be fire-and-forget, which raced against the fresh value
 * being written right after (the delayed DEL could wipe the new entry).
 */
export async function clearAllCache(): Promise<void> {
  memCache.flushAll();

  if (isVercel) {
    let redis;
    try {
      redis = await getRedis();
      if (redis) {
        const keys = await redis.keys('cache:*');
        if (keys.length > 0) await redis.del(...keys);
      }
    } catch {
      // Redis unavailable — memory cache is already cleared
    } finally {
      redis?.disconnect();
    }
  }
}
