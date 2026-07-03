/**
 * Shared persistence for the small JSON "stores" (owner assignments, meeting
 * settings, labelers). On Vercel the data lives in Redis; locally it lives in
 * `data/<file>.json`. Previously each store re-implemented the Redis client
 * setup and the local file I/O — this module is the single copy.
 */

const isVercel = !!process.env.VERCEL;

/** Connect a short-lived Redis client. Caller must disconnect(). Throws on failure. */
export async function connectRedis(options: { connectTimeout?: number } = {}) {
  const Redis = (await import('ioredis')).default;
  const client = new Redis(process.env.REDIS_URL || '', {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    ...options,
  });
  await client.connect();
  return client;
}

export interface JsonStore<T> {
  read(): Promise<T>;
  write(data: T): Promise<void>;
}

export function createJsonStore<T>(opts: {
  /** Redis key used on Vercel. */
  redisKey: string;
  /** Filename under `data/` used in local development. */
  localFile: string;
  /** Value returned when nothing is stored or the payload is unreadable. */
  fallback: () => T;
  /** Optional shape-normalizer applied to whatever was parsed. */
  normalize?: (raw: unknown) => T;
}): JsonStore<T> {
  const parse = (raw: string | null): T => {
    if (!raw) return opts.fallback();
    const value = JSON.parse(raw) as unknown;
    return opts.normalize ? opts.normalize(value) : (value as T);
  };

  async function readRedis(): Promise<T> {
    let client;
    try {
      client = await connectRedis();
      return parse(await client.get(opts.redisKey));
    } catch {
      return opts.fallback();
    } finally {
      client?.disconnect();
    }
  }

  async function writeRedis(data: T): Promise<void> {
    let client;
    try {
      client = await connectRedis();
      await client.set(opts.redisKey, JSON.stringify(data));
    } finally {
      client?.disconnect();
    }
  }

  async function readLocal(): Promise<T> {
    try {
      const { readFileSync } = await import('fs');
      const { join } = await import('path');
      return parse(readFileSync(join(process.cwd(), 'data', opts.localFile), 'utf-8'));
    } catch {
      return opts.fallback();
    }
  }

  async function writeLocal(data: T): Promise<void> {
    const { writeFileSync, mkdirSync } = await import('fs');
    const { join } = await import('path');
    const dir = join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, opts.localFile), JSON.stringify(data, null, 2), 'utf-8');
  }

  return {
    read: () => (isVercel ? readRedis() : readLocal()),
    write: (data) => (isVercel ? writeRedis(data) : writeLocal(data)),
  };
}
