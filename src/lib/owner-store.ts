import type { OwnerAssignments } from '@/types';
import { createVersionedStore } from '@/lib/store/versioned-store';
import { FORMS } from '@/config/forms';

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

/**
 * Forms hidden until somebody starts entering them.
 *
 * Only a default, and only where nothing has been stored: the moment a manager
 * saves in /assign their list is what counts, including an empty one. That is
 * how a form comes back — untick it and save — without a deploy.
 */
export const DEFAULT_HIDDEN_FORMS: string[] = FORMS.filter(f => f.pendingEntry).map(f => f.name);

export function normalize(raw: unknown): StoreData {
  const empty: StoreData = {
    assignments: {},
    hiddenForms: [...DEFAULT_HIDDEN_FORMS],
    targetIds: { basic: null, exam: null },
  };
  if (!raw || typeof raw !== 'object') return empty;

  const stored = raw as LegacyStoreData;
  const legacyTarget = stored.targetId ?? null;
  return {
    assignments: stored.assignments ?? {},
    hiddenForms: stored.hiddenForms ?? [...DEFAULT_HIDDEN_FORMS],
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
