import { getRedcapUsers } from '@/lib/redcap/users';
import { getAssignments } from '@/lib/owner-store';
import { listPeople } from '@/lib/people/repo';
import { hasDatabase } from '@/lib/db/client';
import { readView, type ReadOptions } from '@/lib/views/view';
import { matrixView } from '@/lib/views/matrix';
import { computeBacklog, type BacklogScope, type PersonBacklog, type UnitRef } from './backlog';

/**
 * Assembling the inputs `computeBacklog` needs from the live system.
 *
 * The matrix comes from the view the operator's screen is already reading:
 * recomputing it takes about a minute against REDCap. A screen may show a
 * slightly older matrix; a reminder mail may not go out on one older than
 * the caller's `maxAgeSeconds`, because it names a person and lists their
 * work, and a list of things they already did teaches them to ignore it.
 */

export interface BacklogSnapshot {
  backlog: PersonBacklog[];
  units: UnitRef[];
  fetchedAt: string;
  /** The matrix behind this is past its freshness window. */
  stale: boolean;
  refreshing: boolean;
}

/**
 * REDCap username → name, shared with the matrix route's cache entry so the
 * two views name the same person the same way and pay for one export.
 */
export async function redcapDirectory(): Promise<Map<string, string>> {
  try {
    const users = await getRedcapUsers();
    return new Map(users.filter(u => u.name).map(u => [u.username, u.name]));
  } catch {
    // A directory lookup failure costs nicer labels, never the backlog.
    return new Map();
  }
}

export async function loadBacklog(scope: BacklogScope = {}, options: ReadOptions = {}): Promise<BacklogSnapshot> {
  const matrix = await readView(matrixView, options);

  const [assignments, people, directory] = await Promise.all([
    getAssignments(),
    hasDatabase() ? listPeople(true).catch(() => []) : Promise.resolve([]),
    redcapDirectory(),
  ]);

  return {
    backlog: computeBacklog({
      records: matrix.data.records,
      units: matrix.data.units,
      assignments,
      people,
      directory,
      scope,
    }),
    units: matrix.data.units,
    fetchedAt: matrix.fetchedAt,
    stale: matrix.stale,
    refreshing: matrix.refreshing,
  };
}
