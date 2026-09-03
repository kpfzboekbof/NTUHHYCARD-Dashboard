/**
 * The WorkUnit catalog — the configuration that decides what a piece of work
 * is, who can be assigned to it, and when it counts as done.
 *
 * A WorkUnit is either a whole REDCap instrument or a named group of fields
 * inside one. Splitting a form so that specific fields belong to specific
 * people is therefore a catalog edit, not a code change; the five hardcoded
 * "virtual forms" in src/config/forms.ts become five ordinary catalog rows.
 *
 * See docs/management-system-redesign.md §4.
 */

export type UnitKind =
  /** A whole REDCap instrument, tracked by its own _complete field. */
  | 'full_form'
  /** A named set of fields inside an instrument, tracked by them being filled. */
  | 'field_group'
  /** A sign-off on someone else's field_group, tracked by the instrument's _complete. */
  | 'verify'
  /** Multi-reviewer adjudication over a repeating instrument (etiology votes). */
  | 'adjudication'
  /** Done when one derived field has a value (etiology_final). */
  | 'derived_field';

export interface RequiredFieldVariant {
  /** Applicability expression, or the literal 'else' for the fallback variant. */
  when: string;
  fields: string[];
  /** Fields exported as `name___option`; any checked option counts as filled. */
  checkboxFields?: string[];
}

export interface ConsensusRule {
  minVotes: number;
  allowSingleDissenter: boolean;
  dissenterMajorityMin: number;
}

/**
 * How a repeating instrument's `_complete` values fold into one answer.
 *
 * 'any' — one complete instance completes the form. What the old pipeline
 *         did (a MAX over the rows), kept as the default so forms that do not
 *         repeat, and repeating forms nobody has asked to tighten, behave
 *         exactly as before.
 * 'all' — every instance must be complete. Right for event forms where each
 *         row is a distinct procedure: three surgeries with one written up is
 *         not a finished surgery form.
 */
export type RepeatAggregation = 'any' | 'all';

export type CompletionRule =
  | { type: 'complete_field'; completeField: string; repeatAggregation?: RepeatAggregation }
  | { type: 'required_fields'; variants: RequiredFieldVariant[] }
  | { type: 'verify'; completeField: string; repeatAggregation?: RepeatAggregation }
  | { type: 'derived_field'; watchField: string }
  | { type: 'adjudication'; consensusRule: ConsensusRule }
  /**
   * Done when the patient has at least `min` rows of the unit's instrument,
   * whatever their `_complete` says. For time-series instruments — ICU labs,
   * post-arrest vitals — where "complete" has no meaning: there is no moment
   * at which a patient's vital signs are finished, only a discharge after which
   * there will be no more. The cell carries the count so the view can say
   * "27 rows" rather than a green tick that claims more than anyone knows.
   */
  | { type: 'instance_count'; min: number };

/**
 * How to read a field off a record.
 *
 * 'main' reads the non-repeating row. 'any' looks across every repeating row —
 * needed for fields that only exist on repeat instruments, such as the etiology
 * votes that decide whether the trauma form applies.
 */
export type FieldAggregation = 'main' | 'any';

export interface GatingField {
  field: string;
  /** Unit whose owner enters this field — names who to chase when it is empty. */
  enteredByUnit: string;
  aggregation?: FieldAggregation;
}

export interface Applicability {
  /** Tri-state expression; an empty gating field makes it UNKNOWN, not false. */
  expr: string;
  gatingFields: GatingField[];
}

export type DependencyType =
  /** Blocked until the named unit is complete. */
  | 'data_gate'
  /** Blocked until the named unit has been entered and is awaiting verification. */
  | 'verify_after'
  /** Never blocks; only orders queues. */
  | 'soft_order';

export interface Dependency {
  unitId: string;
  type: DependencyType;
}

export type UnitCategory = 'basic' | 'exam';

export interface WorkUnit {
  unitId: string;
  label: string;
  /** REDCap instrument this unit reads. */
  redcapForm: string;
  /** REDCap DataEntry page to deep-link to — the one place virtual→real lives. */
  deepLinkPage: string;
  kind: UnitKind;
  completionRule: CompletionRule;
  applicability: Applicability;
  dependencies: Dependency[];
  category: UnitCategory;
  defaultTarget: number;
  sortOrder: number;
  /** Hidden units drop out of queues, heatmap columns and every denominator. */
  hidden?: boolean;
}

export interface CatalogSettings {
  /** Days a ready item may sit before its owner counts as 落後. */
  staleDays: number;
  /** 優 / 良 / 待加強 cutoffs; below the last one is 落後. */
  gradeThresholds: [number, number, number];
  /** Days within which a re-captured chart number is the same OHCA event. */
  screeningDedupWindowDays: number;
}

export interface CatalogDoc {
  units: WorkUnit[];
  settings: CatalogSettings;
}
