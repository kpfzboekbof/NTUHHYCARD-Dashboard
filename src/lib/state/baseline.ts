import { gzipSync, gunzipSync } from 'node:zlib';
import { get, list, put } from '@vercel/blob';
import type { Baseline } from './diff';

/**
 * The diff baseline: the last matrix a snapshot run saw, persisted so the next
 * run can say what changed. Blob rather than the database because it is one
 * medium-sized document rewritten wholesale — and because losing it costs one
 * diff cycle, nothing more (the queue re-derives from REDCap).
 *
 * Gzipped: the raw JSON is ~17MB of studyIds, unit ids and state names
 * repeated a quarter-million times; compressed it is under a megabyte. The
 * path carries the encoding so a later format change cannot misread old bytes.
 */

const BASELINE_PATH = 'state/baseline.json.gz';

/**
 * A hung store call must become a crisp failure: the snapshot cron treats any
 * baseline error as "first run / skip diff", and the watchdog reports
 * staleness — both better outcomes than eating the function's whole time
 * budget waiting on a socket.
 */
const STORE_TIMEOUT_MS = 60_000;

export function encodeBaseline(baseline: Baseline): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(baseline), 'utf8'));
}

export function decodeBaseline(compressed: Buffer): Baseline | null {
  try {
    const parsed = JSON.parse(gunzipSync(compressed).toString('utf8')) as Partial<Baseline>;
    if (!parsed || typeof parsed.fetchedAt !== 'string' || !Array.isArray(parsed.records)) return null;
    return { fetchedAt: parsed.fetchedAt, records: parsed.records };
  } catch {
    return null;
  }
}

export async function readBaseline(): Promise<Baseline | null> {
  try {
    const result = await get(BASELINE_PATH, {
      access: 'private',
      // Always from origin: the CDN caches private blobs for up to a month by
      // default, and a frozen baseline would re-emit the same diff every day
      // while the watchdog cries stale at a cron that is in fact succeeding.
      useCache: false,
      abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const compressed = Buffer.from(await new Response(result.stream).arrayBuffer());
    return decodeBaseline(compressed);
  } catch {
    // A missing or unreadable baseline is the first-run case: diff nothing.
    return null;
  }
}

export async function writeBaseline(baseline: Baseline): Promise<void> {
  await put(BASELINE_PATH, encodeBaseline(baseline), {
    access: 'private',
    contentType: 'application/gzip',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60, // the SDK's minimum; this blob is rewritten daily
    abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
}

export interface BaselineStatus {
  /** True when there is one, false when there is not, null when we could not ask. */
  exists: boolean | null;
  /** When the blob was last written — i.e. the last snapshot that succeeded. */
  uploadedAt: string | null;
  bytes: number | null;
}

/**
 * Whether a baseline exists and when it was written, without downloading it.
 *
 * `readBaseline` pulls about a megabyte and inflates it to seventeen; a status
 * page asking only "is there one, and how old" has no business paying that.
 *
 * It is also the only record of snapshots that ran before the run ledger
 * existed: the blob's write time is, by construction, the last time a snapshot
 * succeeded, so a fresh ledger does not make years of history look like never.
 */
export async function baselineStatus(): Promise<BaselineStatus> {
  try {
    const { blobs } = await list({
      prefix: BASELINE_PATH,
      limit: 1,
      abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
    const blob = blobs[0];
    if (!blob) return { exists: false, uploadedAt: null, bytes: null };

    return {
      exists: true,
      uploadedAt: new Date(blob.uploadedAt).toISOString(),
      bytes: blob.size,
    };
  } catch {
    // Unreachable store: `null` says we could not ask. Answering `false` would
    // read as a broken cron when the cron is fine and it is the blob store
    // that is down — the exact kind of confident wrong answer this page exists
    // to stop.
    return { exists: null, uploadedAt: null, bytes: null };
  }
}
