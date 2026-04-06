import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { OwnerAssignments } from '@/types';

const FILE_PATH = join(process.cwd(), 'data', 'owner-assignments.json');

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

function readStore(): StoreData {
  try {
    const raw = readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(data: StoreData): void {
  writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export function getAssignments(): OwnerAssignments {
  const data = readStore();
  return data.assignments ?? {};
}

export function setAssignments(assignments: OwnerAssignments): void {
  const data = readStore();
  data.assignments = assignments;
  writeStore(data);
}

export function getHiddenForms(): string[] {
  const data = readStore();
  return data.hiddenForms ?? [];
}

export function setHiddenForms(hiddenForms: string[]): void {
  const data = readStore();
  data.hiddenForms = hiddenForms;
  writeStore(data);
}

export function getTargetIds(): TargetIds {
  const data = readStore();
  if (data.targetIds) return data.targetIds;
  // Migrate from legacy single targetId
  const legacy = data.targetId ?? null;
  return { basic: legacy, exam: legacy };
}

export function setTargetIds(targetIds: TargetIds): void {
  const data = readStore();
  data.targetIds = targetIds;
  delete data.targetId; // remove legacy
  writeStore(data);
}
