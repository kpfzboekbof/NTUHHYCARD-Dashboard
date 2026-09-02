import { indexByUsername, ownersForUnits, resolveOwner } from './ownership';
import type { PersonRef, ResolvedOwner } from './ownership';
import type { BlockReason, CellState, RecordDerivation } from './types';
import type { OwnerAssignments } from '@/types';

/**
 * Why work is stuck, grouped by whoever has to move first.
 *
 * 「30 筆被擋住：22 筆等王小明的 sur_icu、8 筆等 etiology 共識」— the fastest
 * answer to "who do I chase", and the place a reminder button actually belongs.
 * See docs/management-system-redesign.md §9.1（被擋住反向分組）.
 *
 * Blocked cells are excluded from their own owner's score, so this view is the
 * other half of that decision: the work has not disappeared, it has moved to
 * somebody else's name.
 */

export interface BlockedUnitCount {
  unitId: string;
  label: string;
  count: number;
}

export interface BlockerGroup {
  key: string;
  kind: BlockReason['kind'];
  /** What the operator reads: 「等 sur_icu（王小明）」 */
  label: string;
  /** The unit whose owner has to act, when the reason names one. */
  blockingUnitId: string | null;
  blockingUnitLabel: string | null;
  /** Who to chase; null when nobody owns the blocker (or nobody is assigned). */
  owner: ResolvedOwner | null;
  count: number;
  /** Which units are waiting behind this, largest first. */
  waitingUnits: BlockedUnitCount[];
  /** A handful of study ids, so the group can be opened rather than believed. */
  sampleStudyIds: string[];
}

export interface BlockerUnitRef {
  unitId: string;
  label: string;
}

export interface BlockerInput {
  records: RecordDerivation[];
  units: BlockerUnitRef[];
  assignments: OwnerAssignments;
  people: PersonRef[];
  directory?: Map<string, string>;
  /** Only blocked cells belonging to this owner's units. */
  forUsername?: string;
  /** Study ids kept per group. Default 5. */
  sampleSize?: number;
}

/** Stable identity for a reason, so counts aggregate across records. */
function reasonKey(reason: BlockReason | undefined): string {
  if (!reason) return 'unknown';
  switch (reason.kind) {
    case 'awaiting_gate': return `awaiting_gate|${reason.field}|${reason.enteredByUnit}`;
    case 'awaiting_unit': return `awaiting_unit|${reason.unitId}`;
    case 'awaiting_config': return `awaiting_config|${reason.detail}`;
    default: return reason.kind;
  }
}

/** The unit whose owner has to act before this reason clears. */
function blockingUnitOf(reason: BlockReason | undefined): string | null {
  if (!reason) return null;
  if (reason.kind === 'awaiting_gate') return reason.enteredByUnit;
  if (reason.kind === 'awaiting_unit') return reason.unitId;
  return null;
}

function labelFor(
  reason: BlockReason | undefined,
  blockingLabel: string | null,
  owner: ResolvedOwner | null,
): string {
  const who = owner ? `（${owner.displayName}）` : '（未指派）';
  if (!reason) return '原因不明';
  switch (reason.kind) {
    case 'excluded': return '病人已排除';
    case 'awaiting_gate': return `等 ${reason.field}${who}`;
    case 'awaiting_unit': return `等 ${blockingLabel ?? reason.unitId}${who}`;
    case 'awaiting_consensus': return '等 etiology 共識';
    // Not somebody's slowness: the catalog itself is wrong, and it is the
    // registry lead's to fix rather than anyone's to be chased about.
    case 'awaiting_config': return `目錄設定問題：${reason.detail}`;
  }
}

interface Accumulator {
  kind: BlockReason['kind'];
  reason: BlockReason | undefined;
  count: number;
  units: Map<string, number>;
  samples: string[];
}

/**
 * One pass over the matrix, bucketed by the owner of the *waiting* cell.
 *
 * The whole-registry view and every person's view come out of the same walk:
 * at target size the matrix is around 200k cells, and re-walking it once per
 * person would cost a couple of million iterations to answer a question that
 * one pass already answers.
 */
function accumulate(
  records: RecordDerivation[],
  ownerByUnit: Map<string, string>,
  sampleSize: number,
  forUsername: string | undefined,
): { all: Map<string, Accumulator>; byOwner: Map<string, Map<string, Accumulator>> } {
  const all = new Map<string, Accumulator>();
  const byOwner = new Map<string, Map<string, Accumulator>>();

  const bucket = (into: Map<string, Accumulator>, key: string, cell: CellState, studyId: string) => {
    let group = into.get(key);
    if (!group) {
      into.set(key, group = {
        kind: cell.blockReason?.kind ?? 'awaiting_config',
        reason: cell.blockReason, count: 0, units: new Map(), samples: [],
      });
    }
    group.count++;
    group.units.set(cell.unitId, (group.units.get(cell.unitId) ?? 0) + 1);
    if (group.samples.length < sampleSize) group.samples.push(studyId);
  };

  for (const record of records) {
    for (const cell of record.cells) {
      if (cell.state !== 'blocked') continue;
      const owner = ownerByUnit.get(cell.unitId);
      if (forUsername && owner !== forUsername) continue;

      const key = reasonKey(cell.blockReason);
      bucket(all, key, cell, record.studyId);
      if (owner) {
        let mine = byOwner.get(owner);
        if (!mine) byOwner.set(owner, mine = new Map());
        bucket(mine, key, cell, record.studyId);
      }
    }
  }

  return { all, byOwner };
}

function finalize(
  groups: Map<string, Accumulator>,
  ownerByUnit: Map<string, string>,
  labelByUnit: Map<string, string>,
  personByUsername: Map<string, PersonRef>,
  directory: Map<string, string> | undefined,
): BlockerGroup[] {
  const result: BlockerGroup[] = [];
  for (const [key, group] of groups) {
    const blockingUnitId = blockingUnitOf(group.reason);
    const blockingUsername = blockingUnitId ? ownerByUnit.get(blockingUnitId) : undefined;
    const owner = blockingUsername ? resolveOwner(blockingUsername, personByUsername, directory) : null;
    const blockingUnitLabel = blockingUnitId ? labelByUnit.get(blockingUnitId) ?? null : null;

    result.push({
      key,
      kind: group.kind,
      label: labelFor(group.reason, blockingUnitLabel, owner),
      blockingUnitId,
      blockingUnitLabel,
      owner,
      count: group.count,
      waitingUnits: [...group.units.entries()]
        .map(([unitId, count]) => ({ unitId, label: labelByUnit.get(unitId) ?? unitId, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      sampleStudyIds: group.samples,
    });
  }
  return result.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function groupByBlocker(input: BlockerInput): BlockerGroup[] {
  const { records, units, assignments, people, directory, forUsername, sampleSize = 5 } = input;
  const ownerByUnit = ownersForUnits(units, assignments);
  const { all } = accumulate(records, ownerByUnit, sampleSize, forUsername);
  return finalize(all, ownerByUnit, new Map(units.map(u => [u.unitId, u.label])), indexByUsername(people), directory);
}

/**
 * The same grouping, split by whose work is stuck — every owner's drill-down
 * from a single walk of the matrix.
 */
export function groupByBlockerPerOwner(input: BlockerInput): Map<string, BlockerGroup[]> {
  const { records, units, assignments, people, directory, sampleSize = 5 } = input;
  const ownerByUnit = ownersForUnits(units, assignments);
  const labelByUnit = new Map(units.map(u => [u.unitId, u.label]));
  const personByUsername = indexByUsername(people);
  const { byOwner } = accumulate(records, ownerByUnit, sampleSize, undefined);

  return new Map(
    [...byOwner.entries()].map(([username, groups]) => [
      username,
      finalize(groups, ownerByUnit, labelByUnit, personByUsername, directory),
    ]),
  );
}
