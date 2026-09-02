import { indexByUsername, ownersForUnits, resolveOwner } from './ownership';
import type { NameSource, PersonRef } from './ownership';
import type { RecordDerivation } from './types';
import type { OwnerAssignments } from '@/types';

export type { NameSource, PersonRef };

/**
 * Who still owes what.
 *
 * One function behind both the ad-hoc nudge and the batch reminder, so the
 * count in somebody's mail and the count on the operator's screen cannot come
 * from two different pieces of arithmetic.
 *
 * "Outstanding" means ready or entered_awaiting_verify — work this person can
 * actually do right now. Blocked cells are deliberately excluded: chasing
 * someone for work they are not allowed to start yet is the specific failure
 * the state machine exists to stop.
 */

export interface UnitRef {
  unitId: string;
  label: string;
  deepLinkPage: string;
}

export interface UnitBacklog extends UnitRef {
  /** Actionable now, nothing entered. */
  ready: string[];
  /** Entered and waiting for this person to verify. */
  awaiting: string[];
}

export interface PersonBacklog {
  /** Null when the assignment names a REDCap username no person row matches. */
  personId: string | null;
  /** The REDCap username the assignment is keyed on. */
  username: string;
  displayName: string;
  nameSource: NameSource;
  email: string | null;
  units: UnitBacklog[];
  readyCount: number;
  awaitingCount: number;
  total: number;
}

export interface BacklogScope {
  /** Only records with a numeric study id at or below this. */
  studyIdCutoff?: number | null;
  /** Only these units. Empty or absent means every unit in the matrix. */
  unitIds?: string[];
}

export interface BacklogInput {
  records: RecordDerivation[];
  units: UnitRef[];
  /** Legacy form name → REDCap username. Phase 5 replaces this with rules. */
  assignments: OwnerAssignments;
  people: PersonRef[];
  /**
   * REDCap username → the account owner's name, from REDCap's own user list.
   *
   * Showing a raw username where a name is available reads as a system that
   * does not know who its own people are, so this is used whenever the
   * registry has no row — which is every row until somebody runs the import.
   */
  directory?: Map<string, string>;
  scope?: BacklogScope;
}

/** The unit is in scope for this batch. */
function unitInScope(unitId: string, unitIds?: string[]): boolean {
  return !unitIds || unitIds.length === 0 || unitIds.includes(unitId);
}

/**
 * Per-person outstanding work, sorted by who owes the most.
 *
 * People with nothing outstanding are omitted — a reminder saying "you have 0
 * remaining" trains the recipient to ignore the sender.
 */
export function computeBacklog(input: BacklogInput): PersonBacklog[] {
  const { records, units, assignments, people, directory, scope = {} } = input;
  const { studyIdCutoff = null, unitIds } = scope;

  const personByUsername = indexByUsername(people);

  // unitId → the REDCap username it is assigned to, for units in scope only.
  const inScope = units.filter(unit => unitInScope(unit.unitId, unitIds));
  const ownerByUnit = ownersForUnits(inScope, assignments);
  const unitById = new Map(inScope.filter(u => ownerByUnit.has(u.unitId)).map(u => [u.unitId, u]));
  if (ownerByUnit.size === 0) return [];

  const byUsername = new Map<string, Map<string, UnitBacklog>>();

  for (const record of records) {
    if (studyIdCutoff !== null) {
      const numeric = Number(record.studyId);
      // A non-numeric study id cannot be compared to a cutoff; leaving it in
      // would silently widen every batch, so it is out of scope.
      if (!Number.isFinite(numeric) || numeric > studyIdCutoff) continue;
    }

    for (const cell of record.cells) {
      if (cell.state !== 'ready' && cell.state !== 'entered_awaiting_verify') continue;
      const username = ownerByUnit.get(cell.unitId);
      if (!username) continue;

      let units = byUsername.get(username);
      if (!units) byUsername.set(username, units = new Map());

      let backlog = units.get(cell.unitId);
      if (!backlog) units.set(cell.unitId, backlog = { ...unitById.get(cell.unitId)!, ready: [], awaiting: [] });

      if (cell.state === 'ready') backlog.ready.push(record.studyId);
      else backlog.awaiting.push(record.studyId);
    }
  }

  const result: PersonBacklog[] = [];
  for (const [username, units] of byUsername) {
    const unitList = [...units.values()].sort((a, b) => b.ready.length + b.awaiting.length - (a.ready.length + a.awaiting.length));
    const readyCount = unitList.reduce((n, u) => n + u.ready.length, 0);
    const awaitingCount = unitList.reduce((n, u) => n + u.awaiting.length, 0);

    result.push({
      ...resolveOwner(username, personByUsername, directory),
      units: unitList,
      readyCount,
      awaitingCount,
      total: readyCount + awaitingCount,
    });
  }

  return result.sort((a, b) => b.total - a.total);
}
