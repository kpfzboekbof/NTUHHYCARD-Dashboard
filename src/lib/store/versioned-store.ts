/**
 * Versioned JSON store shared by the app-state blobs (owner assignments,
 * labelers, meeting settings).
 *
 * Every one of those stores used to do an unguarded read-modify-write of a
 * single JSON value, so two admins saving different settings at the same time
 * silently lost one of the two writes. Values are now wrapped in a
 * `{ version, data }` envelope and written with a compare-and-set, and
 * `updateStore` retries the caller's mutation against fresh data on conflict —
 * so concurrent edits to different fields both survive.
 *
 * Storage backend matches the rest of the app: Redis on Vercel, a JSON file
 * under ./data in local development.
 */

export interface VersionedDoc<T> {
  version: number;
  data: T;
}

export class VersionConflictError extends Error {
  readonly expectedVersion: number;
  readonly currentVersion: number;

  constructor(expectedVersion: number, currentVersion: number) {
    super(`版本衝突：預期 ${expectedVersion}，目前 ${currentVersion}`);
    this.name = 'VersionConflictError';
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

export interface VersionedStore<T> {
  /** Current value with its version, for callers that want to do their own CAS. */
  read(): Promise<VersionedDoc<T>>;
  /** Compare-and-set. Throws VersionConflictError when the version moved on. */
  write(data: T, expectedVersion: number): Promise<VersionedDoc<T>>;
  /** Read-modify-write that retries against fresh data on conflict. */
  update(mutate: (current: T) => T): Promise<VersionedDoc<T>>;
}

interface StoreOptions<T> {
  redisKey: string;
  /** File name under ./data used in local development. */
  localFile: string;
  /** Coerce whatever is stored (including pre-envelope values) into T. */
  normalize: (raw: unknown) => T;
}

const isVercel = !!process.env.VERCEL;
const MAX_UPDATE_ATTEMPTS = 4;

/**
 * Atomic compare-and-set. Returns -1 on success, otherwise the version that is
 * actually stored. Runs inside Redis so no other writer can interleave.
 */
const CAS_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local expected = tonumber(ARGV[1])
local currentVersion = 0
if raw then
  local ok, decoded = pcall(cjson.decode, raw)
  if ok and type(decoded) == 'table' and decoded.version then
    currentVersion = tonumber(decoded.version) or 0
  end
end
if currentVersion ~= expected then
  return currentVersion
end
redis.call('SET', KEYS[1], ARGV[2])
return -1
`;

async function withRedis<R>(fn: (client: import('ioredis').Redis) => Promise<R>): Promise<R> {
  const Redis = (await import('ioredis')).default;
  const client = new Redis(process.env.REDIS_URL || '', {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    client.disconnect();
  }
}

/**
 * Unwrap a stored value. Anything without a numeric `version` is a value
 * written before this module existed, and counts as version 0.
 */
function unwrap<T>(raw: unknown, normalize: (raw: unknown) => T): VersionedDoc<T> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const envelope = raw as { version?: unknown; data?: unknown };
    if (typeof envelope.version === 'number' && 'data' in envelope) {
      return { version: envelope.version, data: normalize(envelope.data) };
    }
  }
  return { version: 0, data: normalize(raw) };
}

export function createVersionedStore<T>(options: StoreOptions<T>): VersionedStore<T> {
  const { redisKey, localFile, normalize } = options;

  function localPath(): { dir: string; file: string } {
    // Required lazily so the module stays importable from the browser bundle.
    const { join } = require('path') as typeof import('path');
    const dir = join(process.cwd(), 'data');
    return { dir, file: join(dir, localFile) };
  }

  function readLocalRaw(): unknown {
    try {
      const { readFileSync } = require('fs') as typeof import('fs');
      return JSON.parse(readFileSync(localPath().file, 'utf-8'));
    } catch {
      return null;
    }
  }

  function writeLocalRaw(doc: VersionedDoc<T>): void {
    const { writeFileSync, mkdirSync } = require('fs') as typeof import('fs');
    const { dir, file } = localPath();
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(doc, null, 2), 'utf-8');
  }

  async function read(): Promise<VersionedDoc<T>> {
    if (!isVercel) return unwrap(readLocalRaw(), normalize);
    try {
      const raw = await withRedis(client => client.get(redisKey));
      return unwrap(raw ? JSON.parse(raw) : null, normalize);
    } catch {
      // A Redis read failure must not look like "the store is empty" to a
      // caller about to overwrite it, so report version -1: every CAS against
      // it fails and update() surfaces the error instead of wiping the value.
      return { version: -1, data: normalize(null) };
    }
  }

  async function write(data: T, expectedVersion: number): Promise<VersionedDoc<T>> {
    const next: VersionedDoc<T> = { version: expectedVersion + 1, data };

    if (!isVercel) {
      const current = unwrap(readLocalRaw(), normalize);
      if (current.version !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, current.version);
      }
      writeLocalRaw(next);
      return next;
    }

    const result = await withRedis(client =>
      client.eval(CAS_SCRIPT, 1, redisKey, String(expectedVersion), JSON.stringify(next)),
    );
    if (Number(result) !== -1) {
      throw new VersionConflictError(expectedVersion, Number(result));
    }
    return next;
  }

  async function update(mutate: (current: T) => T): Promise<VersionedDoc<T>> {
    let lastConflict: VersionConflictError | undefined;
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
      const current = await read();
      try {
        return await write(mutate(current.data), current.version);
      } catch (error) {
        if (!(error instanceof VersionConflictError)) throw error;
        lastConflict = error;
      }
    }
    throw lastConflict ?? new Error('儲存失敗：版本持續衝突');
  }

  return { read, write, update };
}
