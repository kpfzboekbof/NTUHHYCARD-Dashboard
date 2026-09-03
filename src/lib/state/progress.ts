import { indexByUsername, ownersForUnits, resolveOwner } from './ownership';
import type { NameSource, PersonRef, ResolvedOwner } from './ownership';
import type { RecordDerivation, WorkState } from './types';
import type { OwnerAssignments } from '@/types';

/** The progress model needs exactly the shared person shape. */
export type ProgressPersonRef = PersonRef;

/**
 * Per-person progress — the answer to "how is everyone doing", computed from
 * the same state matrix every other view reads.
 *
 * The old numbers were wrong in a specific, unfair way: the numerator counted
 * only applicable patients while the denominator was a flat batch target, so
 * somebody owning an ICU-only form was measured against 6,000 patients when
 * roughly 2,200 could ever apply. Their score could not exceed 37% however
 * complete their work was. Numerator and denominator are now the same
 * population — the cells that actually exist for them.
 */

/** Which unit kinds are somebody else's to sign off. */
const VERIFY_KINDS = new Set(['verify']);

export interface ProgressUnitRef {
  unitId: string;
  label: string;
  /** `verify` units are complete only when signed off; others count entry. */
  kind: string;
}

/** When a still-open cell first became workable, keyed `studyId|unitId`. */
export type ReadySince = Map<string, string>;

export interface RedcapActivity {
  /** Last save this username made, ISO. */
  lastEntryAt: string;
  /** Saves within the activity window. */
  count: number;
}

export type Grade = '優' | '良' | '待加強' | '落後' | '無可動工項目';

export interface UnitProgress {
  unitId: string;
  label: string;
  ready: number;
  inProgress: number;
  awaitingVerify: number;
  blocked: number;
  complete: number;
  /** Patients this unit does not apply to at all. */
  notApplicable: number;
  /** Applicable and not blocked — the denominator this unit contributes. */
  workable: number;
  /** Counts as done for this owner (see VERIFY_KINDS). */
  done: number;
}

export interface PersonProgress {
  personId: string | null;
  username: string;
  displayName: string;
  email: string | null;
  nameSource: NameSource;

  units: UnitProgress[];

  readyCount: number;
  inProgressCount: number;
  awaitingVerifyCount: number;
  /** Explicitly not their fault; excluded from the score entirely. */
  blockedCount: number;
  completedTotal: number;
  /** Applicable minus blocked. Zero means there is nothing to grade. */
  applicableTotal: number;
  /** completedTotal ÷ applicableTotal, or null when nothing is workable. */
  pct: number | null;
  grade: Grade;

  /** Age in days of the oldest still-ready item; null when none are ready. */
  oldestReadyDays: number | null;
  /** True when nothing was saved in REDCap within the activity window. */
  stalled: boolean;
  lastRedcapActivity: string | null;
  redcapSaves: number;
}

export interface ProgressInput {
  records: RecordDerivation[];
  units: ProgressUnitRef[];
  assignments: OwnerAssignments;
  people: ProgressPersonRef[];
  /** REDCap username → name, for owners with no registry row. */
  directory?: Map<string, string>;
  /** REDCap username → activity, keyed on username rather than display name. */
  activity?: Map<string, RedcapActivity>;
  /** From `work_event`: when each open cell became ready. */
  readySince?: ReadySince;
  /** A ready item older than this makes 落後 possible. Design default: 14. */
  staleDays?: number;
  now?: Date;
}

function emptyUnitProgress(unit: ProgressUnitRef): UnitProgress {
  return {
    unitId: unit.unitId,
    label: unit.label,
    ready: 0, inProgress: 0, awaitingVerify: 0, blocked: 0, complete: 0,
    notApplicable: 0, workable: 0, done: 0,
  };
}

/** Which states a cell counts towards, shared by the per-person and per-unit tallies. */
function tallyCell(progress: UnitProgress, state: WorkState, kind: string): void {
  switch (state) {
    case 'ready': progress.ready++; break;
    case 'in_progress': progress.inProgress++; break;
    case 'entered_awaiting_verify': progress.awaitingVerify++; break;
    case 'blocked': progress.blocked++; break;
    case 'complete': progress.complete++; break;
    case 'not_applicable': progress.notApplicable++; return;
  }
  // Blocked is applicable but not theirs to move, so it stays out of the
  // denominator as well as the numerator.
  if (state !== 'blocked') progress.workable++;
  if (countsAsDone(state, kind)) progress.done++;
}

/**
 * Whether this state counts as work finished by the unit's owner.
 *
 * `entered_awaiting_verify` is the assistant having filled the form in full
 * while the doctor has not signed it off. It is done as far as the assistant
 * is concerned, and their score must not move with somebody else's signing
 * speed. For a verify unit the same state means the opposite: it is precisely
 * what the owner still owes.
 */
export function countsAsDone(state: WorkState, kind: string): boolean {
  if (state === 'complete') return true;
  return state === 'entered_awaiting_verify' && !VERIFY_KINDS.has(kind);
}

function gradeFor(pct: number | null, oldestReadyDays: number | null, staleDays: number): Grade {
  if (pct === null) return '無可動工項目';
  if (pct >= 90) return '優';
  if (pct >= 60) return '良';
  // 落後 needs both a low score and something genuinely left sitting. Someone
  // who just picked up a new form, or whose queue is small and moving, is not
  // behind — the old rule called both of them lazy.
  if (pct >= 30) return '待加強';
  return oldestReadyDays !== null && oldestReadyDays > staleDays ? '落後' : '待加強';
}

export function computeProgress(input: ProgressInput): PersonProgress[] {
  const {
    records, units, assignments, people,
    directory, activity, readySince,
    staleDays = 14, now = new Date(),
  } = input;

  const personByUsername = indexByUsername(people);

  // unitId → assigned REDCap username, and the unit's own metadata.
  const ownerByUnit = ownersForUnits(units, assignments);
  const unitById = new Map(units.filter(u => ownerByUnit.has(u.unitId)).map(u => [u.unitId, u]));

  const byUsername = new Map<string, Map<string, UnitProgress>>();
  const oldestReady = new Map<string, number>();

  for (const record of records) {
    for (const cell of record.cells) {
      const username = ownerByUnit.get(cell.unitId);
      if (!username) continue;
      const unit = unitById.get(cell.unitId)!;

      let unitMap = byUsername.get(username);
      if (!unitMap) byUsername.set(username, unitMap = new Map());
      let progress = unitMap.get(cell.unitId);
      if (!progress) unitMap.set(cell.unitId, progress = emptyUnitProgress(unit));

      tallyCell(progress, cell.state, unit.kind);

      if (cell.state === 'ready' && readySince) {
        const since = readySince.get(`${record.studyId}|${cell.unitId}`);
        if (since) {
          const days = Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000);
          const current = oldestReady.get(username);
          if (current === undefined || days > current) oldestReady.set(username, days);
        }
      }
    }
  }

  const result: PersonProgress[] = [];
  for (const [username, unitMap] of byUsername) {
    const unitList = [...unitMap.values()].sort((a, b) => b.workable - a.workable);

    const sum = (pick: (u: UnitProgress) => number) => unitList.reduce((n, u) => n + pick(u), 0);
    const applicableTotal = sum(u => u.workable);
    const completedTotal = sum(u => u.done);
    const pct = applicableTotal > 0
      ? Math.round((completedTotal / applicableTotal) * 1000) / 10
      : null;

    const oldestReadyDays = oldestReady.get(username) ?? null;
    const act = activity?.get(username);

    result.push({
      ...resolveOwner(username, personByUsername, directory),
      units: unitList,
      readyCount: sum(u => u.ready),
      inProgressCount: sum(u => u.inProgress),
      awaitingVerifyCount: sum(u => u.awaitingVerify),
      blockedCount: sum(u => u.blocked),
      completedTotal,
      applicableTotal,
      pct,
      grade: gradeFor(pct, oldestReadyDays, staleDays),
      oldestReadyDays,
      // Orthogonal to the score: it separates "behind but working" from
      // "behind and stopped", which one percentage cannot express.
      stalled: !act || act.count === 0,
      lastRedcapActivity: act?.lastEntryAt ?? null,
      redcapSaves: act?.count ?? 0,
    });
  }

  return result.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
}

/**
 * The same tallies per unit across the whole registry, owner attached.
 *
 * The per-person view answers "how is this person doing"; this answers the
 * question the registry lead actually asks first — "how far along is this
 * form" — with the form's own population as the denominator. A person's
 * cross-form total (28,300 of 30,413) mixes a form 7,051 patients need with
 * one 2,209 need and means nothing physical; per form, each number does.
 */

export interface UnitTotals extends UnitProgress {
  kind: string;
  /** The completion rule's type, so a row-counting unit can be rendered as such. */
  ruleType: string | null;
  /** Null when nobody is assigned — the row still shows, that is the point. */
  owner: ResolvedOwner | null;
  /** done ÷ workable, or null when nothing is workable. */
  pct: number | null;
  /** Repeat rows across all patients; null for units whose cells carry no count. */
  rows: number | null;
  /** Patients with at least one row; null likewise. */
  patientsWithRows: number | null;
}

export interface UnitTotalsInput {
  records: RecordDerivation[];
  units: Array<ProgressUnitRef & { ruleType?: string }>;
  assignments: OwnerAssignments;
  people: ProgressPersonRef[];
  directory?: Map<string, string>;
}

export function computeUnitTotals(input: UnitTotalsInput): UnitTotals[] {
  const { records, units, assignments, people, directory } = input;
  const personByUsername = indexByUsername(people);
  const ownerByUnit = ownersForUnits(units, assignments);

  const totals = new Map<string, UnitTotals>();
  for (const unit of units) {
    const username = ownerByUnit.get(unit.unitId);
    totals.set(unit.unitId, {
      ...emptyUnitProgress(unit),
      kind: unit.kind,
      ruleType: unit.ruleType ?? null,
      owner: username ? resolveOwner(username, personByUsername, directory) : null,
      pct: null,
      rows: null,
      patientsWithRows: null,
    });
  }

  for (const record of records) {
    for (const cell of record.cells) {
      const total = totals.get(cell.unitId);
      if (!total) continue;
      tallyCell(total, cell.state, total.kind);
      if (cell.instances !== undefined) {
        total.rows = (total.rows ?? 0) + cell.instances;
        total.patientsWithRows = (total.patientsWithRows ?? 0) + (cell.instances > 0 ? 1 : 0);
      }
    }
  }

  // Input order is catalog order — the workflow — which is how people find a
  // form. The percentage column is there for anyone sorting by trouble.
  return [...totals.values()].map(total => ({
    ...total,
    pct: total.workable > 0 ? Math.round((total.done / total.workable) * 1000) / 10 : null,
  }));
}
