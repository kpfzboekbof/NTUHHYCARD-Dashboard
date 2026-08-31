import type { OwnerAssignments } from '@/types';
import { createVersionedStore } from '@/lib/store/versioned-store';

export interface TargetIds {
  basic: number | null;
  exam: number | null;
}

interface StoreData {
  assignments: OwnerAssignments;
  hiddenForms: string[];
  targetIds: TargetIds;
}

/** Shape written before targets were split into basic/exam. */
interface LegacyStoreData extends Partial<StoreData> {
  targetId?: number | null;
}

function normalize(raw: unknown): StoreData {
  const empty: StoreData = { assignments: {}, hiddenForms: [], targetIds: { basic: null, exam: null } };
  if (!raw || typeof raw !== 'object') return empty;

  const stored = raw as LegacyStoreData;
  const legacyTarget = stored.targetId ?? null;
  return {
    assignments: stored.assignments ?? {},
    hiddenForms: stored.hiddenForms ?? [],
    targetIds: stored.targetIds ?? { basic: legacyTarget, exam: legacyTarget },
  };
}

const store = createVersionedStore<StoreData>({
  redisKey: 'owner-store',
  localFile: 'owner-assignments.json',
  normalize,
});

export async function getAssignments(): Promise<OwnerAssignments> {
  return (await store.read()).data.assignments;
}

export async function setAssignments(assignments: OwnerAssignments): Promise<void> {
  await store.update(current => ({ ...current, assignments }));
}

export async function getHiddenForms(): Promise<string[]> {
  return (await store.read()).data.hiddenForms;
}

export async function setHiddenForms(hiddenForms: string[]): Promise<void> {
  await store.update(current => ({ ...current, hiddenForms }));
}

export async function getTargetIds(): Promise<TargetIds> {
  return (await store.read()).data.targetIds;
}

export async function setTargetIds(targetIds: TargetIds): Promise<void> {
  await store.update(current => ({ ...current, targetIds }));
}
