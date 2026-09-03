import { defineView } from './view';
import { DEPENDENTS, VIEW } from './keys';
import { deriveCurrentMatrix, type CurrentMatrix, type UnitMeta } from '@/lib/state/build';
import { LEGACY_FORM_BY_UNIT_ID } from '@/lib/catalog/seed';
import { getAssignments } from '@/lib/owner-store';
import { getRedcapUsers } from '@/lib/redcap/users';
import { hasDatabase } from '@/lib/db/client';
import { listPeople } from '@/lib/people/repo';
import type { RecordDerivation, WorkState } from '@/lib/state/types';

/**
 * The state matrix as a view: every (record × work unit) cell, plus per-unit
 * rollups and registry totals.
 *
 * Owners are deliberately NOT in the stored view. They come from the
 * assignment map the operator edits on /assign, and baking them into a
 * snapshot that is refreshed on the hour would leave /incomplete and /owners
 * naming the previous owner — and the nudge button mailing them — for up to
 * an hour after a reassignment. `attachOwners` joins them in per request; it
 * costs one Redis read and one small database query.
 */

export const UNASSIGNED = '未指派';

export interface MatrixUnit extends UnitMeta {
  counts: Record<WorkState, number>;
}

export interface StoredMatrix {
  records: RecordDerivation[];
  /** Visible units in catalog order, with their state counts. */
  units: MatrixUnit[];
  totals: {
    records: number;
    excluded: number;
    screeningPending: number;
    /** Records whose every applicable unit is complete. */
    fullyComplete: number;
  };
  catalogVersion: number;
  catalogIsSeed: boolean;
  catalogReadFailed: boolean;
  fetchedAt: string;
}

export interface UnitSummary extends MatrixUnit {
  owner: string;
  /** person.id when the owner's REDCap username is linked in the registry. */
  ownerPersonId: string | null;
}

function emptyCounts(): Record<WorkState, number> {
  return {
    not_applicable: 0, blocked: 0, ready: 0,
    in_progress: 0, entered_awaiting_verify: 0, complete: 0,
  };
}

/** Roll a freshly derived matrix up into what the view stores. */
export function summarizeMatrix(matrix: CurrentMatrix): StoredMatrix {
  const { records } = matrix;
  const units = new Map<string, MatrixUnit>(
    matrix.units.map(unit => [unit.unitId, { ...unit, counts: emptyCounts() }]),
  );

  let excluded = 0;
  let screeningPending = 0;
  let fullyComplete = 0;

  for (const record of records) {
    if (record.excluded) excluded++;
    if (record.screeningPending) screeningPending++;

    // Patient-level progress: the unit the registry is actually counted in.
    const applicable = record.cells.filter(c => c.state !== 'not_applicable');
    if (!record.excluded && applicable.length > 0 && applicable.every(c => c.state === 'complete')) {
      fullyComplete++;
    }

    for (const cell of record.cells) {
      const unit = units.get(cell.unitId);
      if (unit) unit.counts[cell.state] += 1;
    }
  }

  return {
    records,
    units: [...units.values()].sort((a, b) => a.sortOrder - b.sortOrder),
    totals: { records: records.length, excluded, screeningPending, fullyComplete },
    catalogVersion: matrix.catalogVersion,
    catalogIsSeed: matrix.catalogIsSeed,
    catalogReadFailed: matrix.catalogReadFailed,
    fetchedAt: matrix.fetchedAt,
  };
}

/**
 * The one way the matrix view is built — the snapshot cron derives the same
 * way and stores the result through `storeView`, so the morning's first page
 * finds it already there.
 */
export const matrixView = defineView<StoredMatrix>({
  key: VIEW.matrix,
  freshSeconds: 1800,
  exportsFromRedcap: true,
  dependents: DEPENDENTS[VIEW.matrix],
  async build() {
    return summarizeMatrix(await deriveCurrentMatrix());
  },
});

/**
 * Owners, joined in from the live assignment map.
 *
 * Owners still come from the form-keyed assignment map; Phase 5 replaces
 * this with assignment rules and the shape of the result does not change.
 */
export async function attachOwners(units: MatrixUnit[]): Promise<UnitSummary[]> {
  const [assignments, users, people] = await Promise.all([
    getAssignments(),
    // A directory lookup failure costs display names, never the page: the
    // stored matrix is good whether or not REDCap answers right now.
    getRedcapUsers().catch(() => []),
    // The person registry link makes a unit's owner nudgeable; without it the
    // owner is still shown by name, there is just nobody to mail.
    hasDatabase() ? listPeople().catch(() => []) : Promise.resolve([]),
  ]);
  const nameByUsername = new Map(users.map(u => [u.username, u.name]));
  const personByUsername = new Map(people.filter(p => p.redcapUsername).map(p => [p.redcapUsername, p.id]));

  return units.map(unit => {
    const formName = LEGACY_FORM_BY_UNIT_ID[unit.unitId] ?? unit.unitId;
    const username = assignments[formName];
    return {
      ...unit,
      owner: (username && nameByUsername.get(username)) || username || UNASSIGNED,
      ownerPersonId: username ? (personByUsername.get(username) ?? null) : null,
    };
  });
}
