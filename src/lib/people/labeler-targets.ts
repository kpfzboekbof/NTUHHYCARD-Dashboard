import { hasDatabase } from '@/lib/db/client';
import { listPeople } from '@/lib/people/repo';
import type { Labeler } from '@/lib/redcap/etiology-transform';
import type { Person } from '@/lib/people/repo';

/**
 * Where a consensus reminder actually gets sent.
 *
 * The labeler store stays the authority on *who the labelers are* — the codes
 * drive the voting columns, the consensus maths and the RSVP links, and none of
 * that moves. What moves is the address: the registry is the one place a
 * person's email is curated, so it wins over the copy kept beside the labeler
 * code. Until somebody links a labeler code in /admin/people, the old address
 * still works, so this is additive on day one.
 */

export interface LabelerTarget {
  code: number;
  /** The registry's name when linked, else the labeler store's. */
  name: string;
  email: string | null;
  /** Set when a person row carries this labeler code — the mail ledger keys on it. */
  personId: string | null;
  /** True when the address came from the registry rather than the labeler store. */
  fromRegistry: boolean;
}

/**
 * The decision for one labeler, pure so the precedence can be tested.
 *
 * `labelerCode` is compared against null explicitly: 0 is a real code in the
 * etiology dropdown, and a truthiness check would strand that labeler on the
 * legacy address forever.
 */
export function pickLabelerTarget(labeler: Labeler, byCode: Map<number, Person>): LabelerTarget {
  const person = byCode.get(labeler.code);
  return {
    code: labeler.code,
    name: person?.displayName ?? labeler.name,
    email: person?.email ?? labeler.email ?? null,
    personId: person?.id ?? null,
    fromRegistry: !!person,
  };
}

export async function resolveLabelerTargets(labelers: Labeler[]): Promise<LabelerTarget[]> {
  const people = hasDatabase() ? await listPeople().catch(() => []) : [];
  const byCode = new Map(
    people
      .filter(p => p.labelerCode !== null && p.active)
      .map(p => [p.labelerCode as number, p]),
  );

  return labelers.map(labeler => pickLabelerTarget(labeler, byCode));
}
