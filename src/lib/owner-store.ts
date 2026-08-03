import { getRedis, isRedisEnabled } from '@/lib/redis';
import type { OwnerAssignments } from '@/types';

export interface TargetIds {
  basic: number | null;
  exam: number | null;
}

export interface StoreData {
  assignments?: OwnerAssignments;
  hiddenForms?: string[];
  targetId?: number | null;       // legacy, migrated to targetIds
  targetIds?: TargetIds;
}

const KV_KEY = 'owner-store';

/* ── Redis (Vercel production) ─────────────────────────── */

async function readRedis(): Promise<StoreData> {
  try {
    const client = await getRedis();
    if (!client) return {};
    const raw = await client.get(KV_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('[owner-store] redis read failed', err);
    return {};
  }
}

async function writeRedis(data: StoreData): Promise<void> {
  const client = await getRedis();
  if (!client) throw new Error('Redis unavailable — owner store not written');
  await client.set(KV_KEY, JSON.stringify(data));
}

/* ── Local file (development) ───────────────────────────── */

async function readLocal(): Promise<StoreData> {
  try {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const raw = readFileSync(join(process.cwd(), 'data', 'owner-assignments.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeLocal(data: StoreData): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('fs');
  const { join } = await import('path');
  const dir = join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'owner-assignments.json'), JSON.stringify(data, null, 2), 'utf-8');
}

/* ── Auto-detect environment ────────────────────────────── */

async function readStore(): Promise<StoreData> {
  return isRedisEnabled ? readRedis() : readLocal();
}

async function writeStore(data: StoreData): Promise<void> {
  return isRedisEnabled ? writeRedis(data) : writeLocal(data);
}

/* ── Public API (all async) ─────────────────────────────── */

/**
 * Read the whole store once.
 *
 * Route handlers should prefer this over calling `getAssignments()` +
 * `getHiddenForms()` + `getTargetIds()`, which was three separate round trips
 * (and, before the shared client, three separate connections) for one small
 * JSON document.
 *
 * Deliberately NOT memoised per request: `PUT /api/owners` does three
 * sequential read-modify-writes over this same blob, and a memoised read
 * would make writes 2 and 3 rebuild from a stale snapshot and clobber write 1.
 */
export async function getOwnerStore(): Promise<StoreData> {
  return readStore();
}

/** Resolve targetIds from an already-loaded store, applying the legacy migration. */
export function pickTargetIds(data: StoreData): TargetIds {
  if (data.targetIds) return data.targetIds;
  const legacy = data.targetId ?? null;
  return { basic: legacy, exam: legacy };
}

export async function getAssignments(): Promise<OwnerAssignments> {
  const data = await readStore();
  return data.assignments ?? {};
}

export async function setAssignments(assignments: OwnerAssignments): Promise<void> {
  const data = await readStore();
  data.assignments = assignments;
  await writeStore(data);
}

export async function getHiddenForms(): Promise<string[]> {
  const data = await readStore();
  return data.hiddenForms ?? [];
}

export async function setHiddenForms(hiddenForms: string[]): Promise<void> {
  const data = await readStore();
  data.hiddenForms = hiddenForms;
  await writeStore(data);
}

export async function getTargetIds(): Promise<TargetIds> {
  return pickTargetIds(await readStore());
}

export async function setTargetIds(targetIds: TargetIds): Promise<void> {
  const data = await readStore();
  data.targetIds = targetIds;
  delete data.targetId;
  await writeStore(data);
}
