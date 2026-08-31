import { LEGACY_FORM_BY_UNIT_ID } from '@/lib/catalog/seed';
import type { OwnerAssignments } from '@/types';
import type { Person } from '@/lib/people/repo';

/**
 * The Phase 3–4 transitional answer to "whose is this unit".
 *
 * Assignment rules arrive in Phase 5. Until then the routing for an event is
 * the old owner-store map (legacy form name → REDCap username) joined through
 * person.redcapUsername — one person per unit, or nobody. The interface is a
 * unitId → personIds map, so swapping in rule resolution later changes nothing
 * downstream.
 */
export function buildUnitRouting(
  unitIds: string[],
  assignments: OwnerAssignments,
  people: Person[],
): Map<string, string[]> {
  const personByUsername = new Map<string, Person>();
  for (const person of people) {
    if (person.redcapUsername && person.active) personByUsername.set(person.redcapUsername, person);
  }

  const routing = new Map<string, string[]>();
  for (const unitId of unitIds) {
    const formName = LEGACY_FORM_BY_UNIT_ID[unitId] ?? unitId;
    const username = assignments[formName];
    const person = username ? personByUsername.get(username) : undefined;
    routing.set(unitId, person ? [person.id] : []);
  }
  return routing;
}
