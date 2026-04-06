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

/* ── Redis via @upstash/redis (Vercel production) ──────── */

async function getRedisClient() {
  const { Redis } = await import('@upstash/redis');
  // Vercel Redis integration sets REDIS_URL automatically
  return Redis.fromEnv();
}

async function readRedis(): Promise<StoreData> {
  try {
    const redis = await getRedisClient();
    const data = await redis.get<StoreData>(KV_KEY);
    return data ?? {};
  } catch {
    return {};
  }
}

async function writeRedis(data: StoreData): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(KV_KEY, data);
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

const isVercel = !!process.env.VERCEL;

async function readStore(): Promise<StoreData> {
  return isVercel ? readRedis() : readLocal();
}

async function writeStore(data: StoreData): Promise<void> {
  return isVercel ? writeRedis(data) : writeLocal(data);
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
  const legacy = data.targetId ?? null;
  return { basic: legacy, exam: legacy };
}

export async function setTargetIds(targetIds: TargetIds): Promise<void> {
  const data = await readStore();
  data.targetIds = targetIds;
  delete data.targetId;
  await writeStore(data);
}
