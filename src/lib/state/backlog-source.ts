import { getCachedAsync } from '@/lib/cache';
import { getAssignments } from '@/lib/owner-store';
import { listPeople } from '@/lib/people/repo';
import { hasDatabase } from '@/lib/db/client';
import { deriveCurrentMatrix } from './build';
import { computeBacklog, type BacklogScope, type PersonBacklog, type UnitRef } from './backlog';
import type { RecordDerivation } from './types';

/**
 * Assembling the inputs `computeBacklog` needs from the live system.
 *
 * The matrix comes from the cache the operator's screen is already reading
 * where possible: recomputing it takes about a minute against REDCap, and a
 * reminder built from a slightly older matrix is fine — the alternative is a
 * button that appears to hang.
 */

interface CachedMatrix {
  records: RecordDerivation[];
  units: UnitRef[];
  fetchedAt: string;
}

export interface BacklogSnapshot {
  backlog: PersonBacklog[];
  units: UnitRef[];
  fetchedAt: string;
}

export async function loadBacklog(scope: BacklogScope = {}): Promise<BacklogSnapshot> {
  const cached = await getCachedAsync<CachedMatrix>('state-matrix');
  const matrix: CachedMatrix = cached?.records && cached.units ? cached : await deriveCurrentMatrix();

  const [assignments, people] = await Promise.all([
    getAssignments(),
    hasDatabase() ? listPeople(true).catch(() => []) : Promise.resolve([]),
  ]);

  return {
    backlog: computeBacklog({
      records: matrix.records,
      units: matrix.units,
      assignments,
      people,
      scope,
    }),
    units: matrix.units,
    fetchedAt: matrix.fetchedAt,
  };
}
