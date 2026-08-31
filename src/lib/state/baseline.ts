import { gzipSync, gunzipSync } from 'node:zlib';
import { get, put } from '@vercel/blob';
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
    abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
}
