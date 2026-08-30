/**
 * The derived work-state model.
 *
 * State is never stored: it is recomputed from a REDCap snapshot every time, so
 * REDCap stays authoritative and the dashboard cannot drift out of sync with it.
 * See docs/management-system-redesign.md §6.
 */

export type WorkState =
  /** Does not apply to this patient (or the record is excluded). */
  | 'not_applicable'
  /** Applies, but cannot be started yet — someone upstream owes something. */
  | 'blocked'
  /** Actionable now, nothing entered yet. */
  | 'ready'
  /** Partially entered. */
  | 'in_progress'
  /** Entered in full and waiting for its verifier — the handoff made visible. */
  | 'entered_awaiting_verify'
  /** Done. */
  | 'complete';

export type BlockReason =
  /** The record is excluded from the registry. */
  | { kind: 'excluded' }
  /** A field that decides applicability is empty; naming who enters it. */
  | { kind: 'awaiting_gate'; field: string; enteredByUnit: string }
  /** An upstream unit has not got far enough yet. */
  | { kind: 'awaiting_unit'; unitId: string }
  /** Etiology consensus has not been reached (or cannot be mapped). */
  | { kind: 'awaiting_consensus' }
  /** The catalog references something that does not exist. */
  | { kind: 'awaiting_config'; detail: string };

export interface CellState {
  studyId: string;
  unitId: string;
  state: WorkState;
  blockReason?: BlockReason;
}

export interface RecordDerivation {
  studyId: string;
  /** REDCap hospital code. */
  hospital: number;
  /** exclusion is set to something other than '0'. */
  excluded: boolean;
  /** Nobody has made the exclusion call yet — counted in, but not screened. */
  screeningPending: boolean;
  cells: CellState[];
}

/**
 * Consensus state for one record's etiology votes, computed by the existing
 * etiology transform and passed in so the consensus rules keep a single home.
 */
export interface AdjudicationSummary {
  completedVotes: number;
  consensus: 'yellow' | 'green' | 'red';
  /** Green and mapping 1:1 onto an etiology_final code. */
  mappable: boolean;
  /** etiology_final already has a value. */
  finalWritten: boolean;
}

/**
 * One record's fields, flattened for evaluation.
 *
 * `repeats` holds the values seen on repeating rows, which is where the
 * etiology votes live — the trauma form's applicability depends on them.
 */
export interface RecordSnapshot {
  studyId: string;
  main: Record<string, string>;
  repeats: Record<string, string[]>;
}
