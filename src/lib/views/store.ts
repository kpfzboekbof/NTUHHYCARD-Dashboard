import { gzipSync, gunzipSync } from 'node:zlib';
import { get, put } from '@vercel/blob';
import { getSql, hasDatabase } from '@/lib/db/client';
import { getCachedAsync, setCached, deleteCached } from '@/lib/cache';
import { redisEnabled } from '@/lib/redis';

/**
 * The durable tier behind `readView`: where the last good build of every
 * derived view is kept between requests and between instances.
 *
 * Two stores, each doing what it is for:
 *
 *  - Postgres (migration 0005) holds one bookkeeping row per view — when the
 *    build's export began, where the bytes are, the refresh lease, the
 *    invalidation mark. One row with an atomic upsert is all the coordination
 *    the refresh needs, and it is what /admin/system reads.
 *  - Vercel Blob holds the build itself, gzipped, beside the diff baseline.
 *    The etiology and log views carry chart numbers and field values; README
 *    reserves the database for management metadata, and Blob is where this
 *    class of derived data already lives.
 *
 * Without a database the whole envelope goes to the small-value cache — Redis
 * on Vercel, memory only in local development — with a day's TTL, which is
 * the behaviour the app had before, minus the five-minute expiry.
 *
 * Timestamps that are compared for equality (the lease token) or against each
 * other (invalidation vs. build start) are minted in JavaScript and sent as
 * parameters rather than taken from now(): Postgres keeps microseconds and the
 * driver returns milliseconds, so a value that made the round trip would no
 * longer compare equal to itself.
 */

/** The row that stands for REDCap: held by whichever background build is exporting. */
export const REDCAP_EXPORT_LOCK = '__redcap_export__';

const BLOB_PREFIX = 'views/';
/**
 * A hung store call must become a crisp failure: readers fall back to a
 * foreground build, which is slower than a hit and better than a page that
 * never answers.
 */
const STORE_TIMEOUT_MS = 30_000;

export interface StoredView<T> {
  data: T;
  fetchedAt: string;
  invalidatedAt: string | null;
  refreshStartedAt: string | null;
  refreshAttempts: number;
  bytes: number;
}

export interface ViewHead {
  key: string;
  fetchedAt: string | null;
  invalidatedAt: string | null;
  refreshStartedAt: string | null;
  refreshAttempts: number;
  bytes: number | null;
}

export function encodeView(data: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(data), 'utf8'));
}

export function decodeView<T>(compressed: Buffer): T {
  return JSON.parse(gunzipSync(compressed).toString('utf8')) as T;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function blobPathFor(key: string): string {
  return `${BLOB_PREFIX}${key}.json.gz`;
}

/* ------------------------------------------------------------------ *
 * Blob: the bytes
 * ------------------------------------------------------------------ */

async function blobWrite(path: string, compressed: Buffer): Promise<void> {
  await put(path, compressed, {
    access: 'private',
    contentType: 'application/gzip',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60, // the SDK's minimum; readers bypass the cache anyway
    abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
}

async function blobRead(path: string): Promise<Buffer | null> {
  const result = await get(path, {
    access: 'private',
    // Always from origin: the CDN caches private blobs for up to a month by
    // default, and a frozen view would keep answering long after the row
    // said there was a newer one.
    useCache: false,
    abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

/* ------------------------------------------------------------------ *
 * Postgres: the bookkeeping
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function headOf(key: string, row: Row): ViewHead {
  return {
    key,
    fetchedAt: iso(row.fetched_at),
    invalidatedAt: iso(row.invalidated_at),
    refreshStartedAt: iso(row.refresh_started_at),
    refreshAttempts: Number(row.refresh_attempts ?? 0),
    bytes: row.bytes === null || row.bytes === undefined ? null : Number(row.bytes),
  };
}

const HEAD_COLUMNS = 'fetched_at, blob_path, bytes, invalidated_at, refresh_started_at, refresh_attempts';

async function dbReadHead(key: string): Promise<(ViewHead & { blobPath: string | null }) | null> {
  const sql = getSql();
  const rows = await sql.query(`SELECT ${HEAD_COLUMNS} FROM derived_snapshot WHERE key = $1`, [key]) as Row[];
  const row = rows[0];
  if (!row) return null;
  return { ...headOf(key, row), blobPath: row.blob_path === null ? null : String(row.blob_path) };
}

async function dbReadFull<T>(key: string): Promise<StoredView<T> | null> {
  const head = await dbReadHead(key);
  if (!head?.fetchedAt || !head.blobPath) return null;
  const compressed = await blobRead(head.blobPath);
  if (!compressed) return null;
  return {
    data: decodeView<T>(compressed),
    fetchedAt: head.fetchedAt,
    invalidatedAt: head.invalidatedAt,
    refreshStartedAt: head.refreshStartedAt,
    refreshAttempts: head.refreshAttempts,
    bytes: head.bytes ?? compressed.byteLength,
  };
}

async function dbWrite(key: string, compressed: Buffer, fetchedAt: string): Promise<string | null> {
  // Bytes first, row second: a row that names a blob that is not there yet
  // would send readers to a 404, while a blob nobody names yet is harmless.
  const path = blobPathFor(key);
  await blobWrite(path, compressed);

  const sql = getSql();
  // `fetchedAt` is when this build's export began. An invalidation after that
  // is about data the build may not have seen, so it survives — and is handed
  // back, because the instance that built may never have seen the write.
  // Anything earlier is answered by this build.
  const rows = await sql.query(
    `INSERT INTO derived_snapshot
       (key, fetched_at, blob_path, bytes, invalidated_at, refresh_started_at, refresh_attempts, updated_at)
     VALUES ($1, $2::timestamptz, $3, $4, NULL, NULL, 0, now())
     ON CONFLICT (key) DO UPDATE SET
       fetched_at         = EXCLUDED.fetched_at,
       blob_path          = EXCLUDED.blob_path,
       bytes              = EXCLUDED.bytes,
       invalidated_at     = CASE
                              WHEN derived_snapshot.invalidated_at > EXCLUDED.fetched_at THEN derived_snapshot.invalidated_at
                              ELSE NULL
                            END,
       refresh_started_at = NULL,
       refresh_attempts   = 0,
       updated_at         = now()
     RETURNING invalidated_at`,
    [key, fetchedAt, path, compressed.byteLength],
  ) as Row[];
  return rows[0] ? iso(rows[0].invalidated_at) : null;
}

async function dbClaim(key: string, leaseSeconds: number, countAttempt: boolean): Promise<string | null> {
  const sql = getSql();
  const token = new Date().toISOString();
  // One statement, so two instances cannot both see "free" and both claim.
  const rows = await sql.query(
    `INSERT INTO derived_snapshot (key, refresh_started_at, refresh_attempts, updated_at)
     VALUES ($1, $3::timestamptz, $4, now())
     ON CONFLICT (key) DO UPDATE SET
       refresh_started_at = $3::timestamptz,
       refresh_attempts   = derived_snapshot.refresh_attempts + $4,
       updated_at         = now()
       WHERE derived_snapshot.refresh_started_at IS NULL
          OR derived_snapshot.refresh_started_at < $3::timestamptz - make_interval(secs => $2)
     RETURNING key`,
    [key, leaseSeconds, token, countAttempt ? 1 : 0],
  ) as Row[];
  return rows.length > 0 ? token : null;
}

async function dbRelease(key: string, token: string): Promise<void> {
  const sql = getSql();
  // Only our own lease: a later claimant's lease must not be freed by a build
  // that outlived its own.
  await sql.query(
    `UPDATE derived_snapshot SET refresh_started_at = NULL, updated_at = now()
      WHERE key = $1 AND refresh_started_at = $2::timestamptz`,
    [key, token],
  );
}

async function dbInvalidate(keys: string[], at: string): Promise<void> {
  const sql = getSql();
  await sql.query(
    `INSERT INTO derived_snapshot (key, invalidated_at, updated_at)
     SELECT k, $2::timestamptz, now() FROM unnest($1::text[]) AS k
     ON CONFLICT (key) DO UPDATE SET invalidated_at = EXCLUDED.invalidated_at, updated_at = now()`,
    [keys, at],
  );
}

async function dbListHeads(): Promise<ViewHead[]> {
  const sql = getSql();
  const rows = await sql.query(
    `SELECT key, ${HEAD_COLUMNS} FROM derived_snapshot ORDER BY key`,
    [],
  ) as Row[];
  return rows.map(row => headOf(String(row.key), row));
}

/* ------------------------------------------------------------------ *
 * Fallback: the small-value cache (Redis on Vercel), one envelope per view.
 * No lease — coordination across instances needs the database — so the
 * in-process guard in view.ts is all that dedupes rebuilds here.
 * ------------------------------------------------------------------ */

interface Envelope {
  fetchedAt: string;
  /** base64(gzip(JSON)) */
  payload: string;
  invalidatedAt?: string | null;
}

const FALLBACK_TTL_SECONDS = 86_400;
const fallbackKey = (key: string) => `view:${key}`;

async function fallbackRead<T>(key: string): Promise<StoredView<T> | null> {
  const envelope = await getCachedAsync<Envelope>(fallbackKey(key));
  if (!envelope?.payload) return null;
  const compressed = Buffer.from(envelope.payload, 'base64');
  return {
    data: decodeView<T>(compressed),
    fetchedAt: envelope.fetchedAt,
    invalidatedAt: envelope.invalidatedAt ?? null,
    refreshStartedAt: null,
    refreshAttempts: 0,
    bytes: compressed.byteLength,
  };
}

async function fallbackHead(key: string): Promise<ViewHead | null> {
  const envelope = await getCachedAsync<Envelope>(fallbackKey(key));
  if (!envelope) return null;
  return {
    key,
    fetchedAt: envelope.fetchedAt ?? null,
    invalidatedAt: envelope.invalidatedAt ?? null,
    refreshStartedAt: null,
    refreshAttempts: 0,
    bytes: envelope.payload ? Buffer.byteLength(envelope.payload, 'base64') : null,
  };
}

function fallbackWrite(key: string, compressed: Buffer, fetchedAt: string): void {
  setCached<Envelope>(fallbackKey(key), { fetchedAt, payload: compressed.toString('base64'), invalidatedAt: null }, FALLBACK_TTL_SECONDS);
}

async function fallbackInvalidate(keys: string[], at: string): Promise<void> {
  // Mark rather than drop: an instance that holds a memory copy learns of an
  // invalidation from the head, and a deleted envelope has no head to read.
  for (const key of keys) {
    const envelope = await getCachedAsync<Envelope>(fallbackKey(key));
    if (envelope) setCached<Envelope>(fallbackKey(key), { ...envelope, invalidatedAt: at }, FALLBACK_TTL_SECONDS);
    else deleteCached(fallbackKey(key));
  }
}

/* ------------------------------------------------------------------ *
 * Public surface. Every function degrades to "no durable tier" on error:
 * the caller still has memory and REDCap, and a page that fails because
 * the cache is down would be worse than a page that is merely slower.
 * ------------------------------------------------------------------ */

/** Which tier is behind the views right now, for the status page. */
export function durableTier(): 'postgres+blob' | 'redis' | 'none' {
  if (hasDatabase()) return 'postgres+blob';
  return redisEnabled() ? 'redis' : 'none';
}

export async function readStoredView<T>(key: string): Promise<StoredView<T> | null> {
  try {
    return hasDatabase() ? await dbReadFull<T>(key) : await fallbackRead<T>(key);
  } catch (error) {
    console.error(`views: read ${key} failed`, error);
    return null;
  }
}

export async function readViewHead(key: string): Promise<ViewHead | null> {
  try {
    return hasDatabase() ? await dbReadHead(key) : await fallbackHead(key);
  } catch (error) {
    console.error(`views: head ${key} failed`, error);
    return null;
  }
}

export interface WriteOutcome {
  /** Compressed size. */
  bytes: number;
  /** An invalidation that arrived during the build and therefore outlives it. */
  invalidatedAt: string | null;
}

/** A failed write is logged, not raised: memory still holds the build. */
export async function writeStoredView(key: string, data: unknown, fetchedAt: string): Promise<WriteOutcome> {
  const compressed = encodeView(data);
  let invalidatedAt: string | null = null;
  try {
    if (hasDatabase()) invalidatedAt = await dbWrite(key, compressed, fetchedAt);
    else fallbackWrite(key, compressed, fetchedAt);
  } catch (error) {
    console.error(`views: write ${key} (${compressed.byteLength} bytes gzipped) failed`, error);
  }
  return { bytes: compressed.byteLength, invalidatedAt };
}

export type LeaseToken = string;

/**
 * Take a lease. Returns a token to release it with, or null when somebody
 * else holds it. `countAttempt` adds to the row's attempt counter — set for
 * background rebuilds, whose only failure signature is the lease expiring.
 *
 * Without a database there is no lease and the answer is always yes; the
 * in-process guard is what remains. When the database cannot be asked the
 * answer is also yes: an occasional duplicate export beats a view that never
 * refreshes.
 */
export async function claimLease(key: string, leaseSeconds: number, countAttempt: boolean): Promise<LeaseToken | null> {
  if (!hasDatabase()) return 'local';
  try {
    return await dbClaim(key, leaseSeconds, countAttempt);
  } catch (error) {
    console.error(`views: claim ${key} failed`, error);
    return 'unverified';
  }
}

export async function releaseLease(key: string, token: LeaseToken): Promise<void> {
  if (!hasDatabase() || token === 'local' || token === 'unverified') return;
  try {
    await dbRelease(key, token);
  } catch (error) {
    console.error(`views: release ${key} failed`, error);
  }
}

export async function invalidateStoredViews(keys: string[], at: string): Promise<void> {
  if (keys.length === 0) return;
  try {
    if (hasDatabase()) await dbInvalidate(keys, at);
    else await fallbackInvalidate(keys, at);
  } catch (error) {
    console.error(`views: invalidate ${keys.join(',')} failed`, error);
  }
}

export async function listViewHeads(): Promise<ViewHead[]> {
  if (!hasDatabase()) return [];
  try {
    return await dbListHeads();
  } catch (error) {
    console.error('views: list failed', error);
    return [];
  }
}
