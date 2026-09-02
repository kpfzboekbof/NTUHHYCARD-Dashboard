import { LEGACY_FORM_BY_UNIT_ID } from '@/lib/catalog/seed';
import type { OwnerAssignments } from '@/types';

/**
 * Who owns a unit, and what we know about them.
 *
 * Four views — the backlog, the progress model, credit attribution and the
 * blocker drill-down — all have to answer "who is this unit's person" the same
 * way, or the number in somebody's reminder disagrees with the number on the
 * operator's screen. One copy, so they cannot drift.
 *
 * Assignments are still keyed on the legacy REDCap form name. Phase 5's
 * assignment rules replace the lookup inside these two functions and nothing
 * else; see docs/management-system-redesign.md §5.
 */

/** The key a unit's assignment is stored under. */
export function assignmentKey(unitId: string): string {
  return LEGACY_FORM_BY_UNIT_ID[unitId] ?? unitId;
}

/** unitId → assigned REDCap username. Unassigned units are absent, not null. */
export function ownersForUnits(
  units: Array<{ unitId: string }>,
  assignments: OwnerAssignments,
): Map<string, string> {
  const owners = new Map<string, string>();
  for (const unit of units) {
    const username = assignments[assignmentKey(unit.unitId)];
    if (username) owners.set(unit.unitId, username);
  }
  return owners;
}

/**
 * Where this person's name came from, which is also how reachable they are.
 *
 * - `registry`: a person row — has an email, can be mailed.
 * - `directory`: REDCap knows the account and its owner's name, but nobody has
 *   imported them into the registry yet, so there is no address to mail.
 * - `unknown`: the assignment names an account REDCap itself does not have.
 *   No import will ever fix this; the assignment is stale.
 */
export type NameSource = 'registry' | 'directory' | 'unknown';

/** The person-registry facts these functions need; a subset of `Person`. */
export interface PersonRef {
  id: string;
  redcapUsername: string | null;
  displayName: string;
  email: string;
  active: boolean;
}

export interface ResolvedOwner {
  username: string;
  /** Null when no active person row carries this REDCap username. */
  personId: string | null;
  displayName: string;
  email: string | null;
  nameSource: NameSource;
}

/** Active people keyed by the REDCap username they are linked to. */
export function indexByUsername(people: PersonRef[]): Map<string, PersonRef> {
  const byUsername = new Map<string, PersonRef>();
  for (const person of people) {
    if (person.redcapUsername && person.active) byUsername.set(person.redcapUsername, person);
  }
  return byUsername;
}

export function resolveOwner(
  username: string,
  people: Map<string, PersonRef>,
  directory?: Map<string, string>,
): ResolvedOwner {
  const person = people.get(username);
  const directoryName = directory?.get(username);
  return {
    username,
    personId: person?.id ?? null,
    // Falling back to the raw username reads as a system that does not know
    // who its own people are, but inventing a name would be worse.
    displayName: person?.displayName ?? directoryName ?? username,
    email: person?.email ?? null,
    nameSource: person ? 'registry' : directoryName ? 'directory' : 'unknown',
  };
}
