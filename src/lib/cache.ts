import NodeCache from 'node-cache';

// In-memory cache (works for local dev, short-lived on Vercel)
const memCache = new NodeCache({ stdTTL: 300 });

// Redis cache for Vercel (persistent across serverless invocations)
const isVercel = !!process.env.VERCEL;

async function getRedis() {
  if (!isVercel) return null;
  try {
    const Redis = (await import('ioredis')).default;
    const client = new Redis(process.env.REDIS_URL || '', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3000,
    });
    await client.connect();
    return client;
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
  if (mem) return mem;

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

export function clearAllCache(): void {
  memCache.flushAll();

  // Clear Redis cache keys too
  if (isVercel) {
    getRedis().then(redis => {
      if (redis) {
        redis.keys('cache:*').then(keys => {
          if (keys.length > 0) redis.del(...keys);
        }).finally(() => redis.disconnect());
      }
    }).catch(() => {});
  }
}
