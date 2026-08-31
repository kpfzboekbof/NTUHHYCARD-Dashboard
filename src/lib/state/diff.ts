import type { CellState, RecordDerivation, WorkState } from './types';

/**
 * Turning two state matrices into handoff events.
 *
 * The queue is always re-derived from the latest snapshot, so this diff can
 * never lose work — it only supplies the "since when" and "why now" behind
 * items the queue already shows. That asymmetry is what makes it safe to run
 * on whatever cadence the deployment can afford.
 */

export type WorkEventType =
  | 'became_ready'
  | 'became_blocked'
  | 'entered_awaiting_verify'
  | 'completed'
  | 'regressed'
  | 'became_na';

export interface WorkEvent {
  studyId: string;
  unitId: string;
  eventType: WorkEventType;
  fromState: WorkState | null;
  toState: WorkState;
  /**
   * For a handoff, the best statement of its cause is what the cell had been
   * waiting on until now — the previous block reason.
   */
  cause: Record<string, unknown> | null;
}

/** How far along a state is; moving backwards is a regression. */
const STATE_RANK: Record<WorkState, number> = {
  not_applicable: 0,
  blocked: 1,
  ready: 2,
  in_progress: 3,
  entered_awaiting_verify: 4,
  complete: 5,
};

function eventTypeFor(from: WorkState | null, to: WorkState): WorkEventType | null {
  if (from === to) return null;

  // A regression outranks the destination's own name: complete → in_progress
  // must read as "slid back", not "someone started working". Falling to
  // blocked or not_applicable is not a regression — that is gating data
  // changing, and those states have their own event types.
  if (from !== null && STATE_RANK[to] < STATE_RANK[from] && to !== 'not_applicable' && to !== 'blocked') {
    return 'regressed';
  }

  switch (to) {
    case 'ready': return 'became_ready';
    case 'blocked': return 'became_blocked';
    case 'entered_awaiting_verify': return 'entered_awaiting_verify';
    case 'complete': return 'completed';
    case 'not_applicable': return 'became_na';
    // in_progress reached forwards is somebody typing, not a handoff: the
    // queue shows it and nothing needs to change hands.
    case 'in_progress': return null;
  }
}

function causeFor(previous: CellState | undefined, next: CellState): Record<string, unknown> | null {
  if (next.state === 'ready' && previous?.blockReason) {
    return { cleared: previous.blockReason };
  }
  if (next.state === 'blocked' && next.blockReason) {
    return { blockedOn: next.blockReason };
  }
  return null;
}

function cellKey(studyId: string, unitId: string): string {
  return `${studyId}|${unitId}`;
}

function indexCells(records: RecordDerivation[]): Map<string, CellState> {
  const cells = new Map<string, CellState>();
  for (const record of records) {
    for (const cell of record.cells) {
      cells.set(cellKey(record.studyId, cell.unitId), cell);
    }
  }
  return cells;
}

/**
 * Events that take the matrix from `previous` to `next`.
 *
 * A cell absent from `previous` (a new record, or a unit newly added to the
 * catalog) emits an event only when it arrives in a state worth acting on —
 * ready or awaiting-verify. Announcing thousands of not-applicable and
 * complete cells on the day a unit is first tracked would bury the handful
 * that matter.
 */
export function diffMatrices(
  previous: RecordDerivation[],
  next: RecordDerivation[],
): WorkEvent[] {
  const before = indexCells(previous);
  const events: WorkEvent[] = [];

  for (const record of next) {
    for (const cell of record.cells) {
      const prior = before.get(cellKey(record.studyId, cell.unitId));

      if (!prior) {
        if (cell.state === 'ready' || cell.state === 'entered_awaiting_verify') {
          events.push({
            studyId: record.studyId,
            unitId: cell.unitId,
            eventType: cell.state === 'ready' ? 'became_ready' : 'entered_awaiting_verify',
            fromState: null,
            toState: cell.state,
            cause: causeFor(undefined, cell),
          });
        }
        continue;
      }

      const eventType = eventTypeFor(prior.state, cell.state);
      if (!eventType) continue;

      events.push({
        studyId: record.studyId,
        unitId: cell.unitId,
        eventType,
        fromState: prior.state,
        toState: cell.state,
        cause: causeFor(prior, cell),
      });
    }
  }

  return events;
}

/** The compact form of a matrix worth persisting as the diff baseline. */
export interface Baseline {
  fetchedAt: string;
  records: RecordDerivation[];
}
