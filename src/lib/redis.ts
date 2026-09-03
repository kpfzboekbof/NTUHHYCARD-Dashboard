import type { Redis } from 'ioredis';

/**
 * One Redis connection per server instance.
 *
 * Every cache read and every app-state read used to open a fresh TCP+TLS
 * connection, run one command and hang up — a handshake per lookup, several
 * per request. Serverless instances are reused between requests (Vercel's
 * fluid compute keeps them warm), so a module-level client amortises the
 * handshake across every request the instance serves; ioredis reconnects on
 * its own if the socket drops in between.
 *
 * Resolves to null wherever Redis is not part of the deployment (local
 * development writes app state to ./data instead), and whenever the connection
 * cannot be made — callers treat that as "no Redis", never as an error.
 */

const isVercel = !!process.env.VERCEL;

let clientPromise: Promise<Redis | null> | null = null;

export function redisEnabled(): boolean {
  return isVercel;
}

export async function getRedis(): Promise<Redis | null> {
  if (!isVercel) return null;
  if (!clientPromise) {
    clientPromise = connect().then(client => {
      // A failed first connection must not poison every later call: forget the
      // attempt so the next request tries again.
      if (!client) clientPromise = null;
      return client;
    });
  }
  return clientPromise;
}

async function connect(): Promise<Redis | null> {
  try {
    const RedisClient = (await import('ioredis')).default;
    const client = new RedisClient(process.env.REDIS_URL || '', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3000,
      // A socket the provider dropped while this instance was frozen is
      // half-open on thaw: the command goes out and no reply ever comes. The
      // old connect-per-call code could stall three seconds at worst; this
      // keeps the same bound.
      commandTimeout: 3000,
      keepAlive: 10_000,
    });
    // An unhandled 'error' event would crash the process; the command that
    // failed already rejected its own promise, which is where callers look.
    client.on('error', () => {});
    client.on('end', () => {
      // The client gave up reconnecting; the next call builds a fresh one.
      if (clientPromise) clientPromise = null;
    });
    await client.connect();
    return client;
  } catch {
    return null;
  }
}
