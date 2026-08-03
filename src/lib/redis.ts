import type { Redis } from 'ioredis';

/**
 * Shared ioredis client.
 *
 * Every module used to build its own `new Redis(...)`, `connect()` and
 * `disconnect()` around a single GET or SET. One cold `/api/completion`
 * opened seven connections that way — each one a DNS + TCP + TLS + AUTH +
 * ready-check round trip before the first byte of the actual command.
 *
 * The client is cached on `globalThis` so it survives module re-evaluation
 * (dev HMR, and separate route-handler bundles in the same instance) and is
 * reused for the lifetime of the serverless instance / container.
 *
 * Nothing calls `disconnect()` any more: the client is shared, so tearing it
 * down in one request would kill in-flight commands in another.
 */

const g = globalThis as unknown as { __ohcaRedis?: Promise<Redis | null> };

/** Redis is only wired up on Vercel — see `isRedisEnabled`. */
export const isRedisEnabled = !!process.env.VERCEL;

export function getRedis(): Promise<Redis | null> {
  if (!isRedisEnabled) return Promise.resolve(null);
  if (g.__ohcaRedis) return g.__ohcaRedis;

  g.__ohcaRedis = (async () => {
    const { default: IORedis } = await import('ioredis');
    const client = new IORedis(process.env.REDIS_URL || '', {
      lazyConnect: true,
      enableReadyCheck: false,   // drops the INFO round trip on connect
      disableClientInfo: true,   // drops the two CLIENT SETINFO round trips
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      keepAlive: 30000,
      retryStrategy: n => Math.min(n * 200, 5000),
    });
    // A shared client reconnects in the background; an unhandled 'error'
    // event would take the process down with it.
    client.on('error', err => {
      console.error('[redis] client error', err);
    });
    await client.connect();
    return client;
  })().catch(err => {
    console.error('[redis] initial connect failed', err);
    g.__ohcaRedis = undefined; // let the next request retry
    return null;
  });

  return g.__ohcaRedis;
}

/**
 * Read helper that gives up rather than holding a request open: a cache miss
 * just means we re-fetch, so a slow Redis must never become the bottleneck it
 * exists to remove. Writes and invalidations deliberately do NOT use this — a
 * truncated DEL is a stale-data correctness bug, not a slow read.
 */
export async function withRedisRead<T>(
  fn: (redis: Redis) => Promise<T>,
  timeoutMs = 2000,
): Promise<T | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    return await Promise.race([
      fn(redis),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch (err) {
    console.error('[redis] read failed', err);
    return null;
  }
}
