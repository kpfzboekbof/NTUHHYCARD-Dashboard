import { createJsonStore } from './kv-store';
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

const store = createJsonStore<StoreData>({
  redisKey: 'owner-store',
  localFile: 'owner-assignments.json',
  fallback: () => ({}),
});

export async function getAssignments(): Promise<OwnerAssignments> {
  const data = await store.read();
  return data.assignments ?? {};
}

export async function setAssignments(assignments: OwnerAssignments): Promise<void> {
  const data = await store.read();
  data.assignments = assignments;
  await store.write(data);
}

export async function getHiddenForms(): Promise<string[]> {
  const data = await store.read();
  return data.hiddenForms ?? [];
}

export async function setHiddenForms(hiddenForms: string[]): Promise<void> {
  const data = await store.read();
  data.hiddenForms = hiddenForms;
  await store.write(data);
}

export async function getTargetIds(): Promise<TargetIds> {
  const data = await store.read();
  if (data.targetIds) return data.targetIds;
  const legacy = data.targetId ?? null;
  return { basic: legacy, exam: legacy };
}

export async function setTargetIds(targetIds: TargetIds): Promise<void> {
  const data = await store.read();
  data.targetIds = targetIds;
  delete data.targetId;
  await store.write(data);
}
