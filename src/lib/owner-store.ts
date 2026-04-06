import type { OwnerAssignments } from '@/types';

export interface TargetIds {
  basic: number | null;
  exam: number | null;
}

interface StoreData {
  assignments?: OwnerAssignments;
  hiddenForms?: string[];
  targetId?: number | null;       // legacy, migrated to targetIds
  targetIds?: TargetIds;
}

const KV_KEY = 'owner-store';

/* ── Vercel KV (production) ─────────────────────────────── */

async function readKV(): Promise<StoreData> {
  try {
    const { kv } = await import('@vercel/kv');
    const data = await kv.get<StoreData>(KV_KEY);
    return data ?? {};
  } catch {
    return {};
  }
}

async function writeKV(data: StoreData): Promise<void> {
  const { kv } = await import('@vercel/kv');
  await kv.set(KV_KEY, data);
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

const useKV = !!process.env.KV_REST_API_URL;

async function readStore(): Promise<StoreData> {
  return useKV ? readKV() : readLocal();
}

async function writeStore(data: StoreData): Promise<void> {
  return useKV ? writeKV(data) : writeLocal(data);
}

/* ── Public API (all async) ─────────────────────────────── */

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
  const data = await readStore();
  if (data.targetIds) return data.targetIds;
  // Migrate from legacy single targetId
  const legacy = data.targetId ?? null;
  return { basic: legacy, exam: legacy };
}

export async function setTargetIds(targetIds: TargetIds): Promise<void> {
  const data = await readStore();
  data.targetIds = targetIds;
  delete data.targetId; // remove legacy
  await writeStore(data);
}
