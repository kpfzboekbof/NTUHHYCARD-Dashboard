import { getCachedAsync, setCached } from '@/lib/cache';
import { fetchUsers } from '@/lib/redcap/client';
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

/**
 * REDCap username → name, shared with the matrix route's cache entry so the
 * two views name the same person the same way and pay for one export.
 */
export async function redcapDirectory(): Promise<Map<string, string>> {
  let users = await getCachedAsync<Array<{ username: string; name: string }>>('redcap_users');
  if (!users) {
    try {
      const raw = await fetchUsers();
      users = raw.map(u => ({ username: u.username, name: `${u.lastname ?? ''}${u.firstname ?? ''}`.trim() }));
      setCached('redcap_users', users, 1800);
    } catch {
      // A directory lookup failure costs nicer labels, never the backlog.
      return new Map();
    }
  }
  return new Map(users.filter(u => u.name).map(u => [u.username, u.name]));
}

export async function loadBacklog(scope: BacklogScope = {}): Promise<BacklogSnapshot> {
  const cached = await getCachedAsync<CachedMatrix>('state-matrix');
  const matrix: CachedMatrix = cached?.records && cached.units ? cached : await deriveCurrentMatrix();

  const [assignments, people, directory] = await Promise.all([
    getAssignments(),
    hasDatabase() ? listPeople(true).catch(() => []) : Promise.resolve([]),
    redcapDirectory(),
  ]);

  return {
    backlog: computeBacklog({
      records: matrix.records,
      units: matrix.units,
      assignments,
      people,
      directory,
      scope,
    }),
    units: matrix.units,
    fetchedAt: matrix.fetchedAt,
  };
}
