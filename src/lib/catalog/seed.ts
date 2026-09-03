import {
  FORMS,
  EXAM_FORMS,
  VIRTUAL_FORMS,
  CORE_ASSISTANT_REQUIRED_FIELDS,
  CORE_ASSISTANT_REQUIRED_FIELDS_NON_ER,
  CORE_ASSISTANT_CHECKBOX_FIELDS,
  OUTCOME_ASSISTANT_REQUIRED_FIELDS,
} from '@/config/forms';
import type { CatalogDoc, CatalogSettings, CompletionRule, WorkUnit } from './types';

/**
 * Builds the catalog that reproduces today's behaviour exactly.
 *
 * Derived from src/config/forms.ts rather than hand-copied, so the two cannot
 * drift while the old completion pipeline is still running alongside the new
 * one. Once every reader is on the catalog, forms.ts retires and this becomes
 * the starting point that the admin UI edits.
 *
 * 34 units: 32 carried over 1:1 from FORMS, ntuh_nhi_etiology re-seeded as the
 * adjudication unit `etiology.vote`, and `patient.screening` added for the
 * exclusion decision that today has no owner at all.
 */

export const SEED_SETTINGS: CatalogSettings = {
  staleDays: 14,
  gradeThresholds: [90, 60, 30],
  screeningDedupWindowDays: 3,
};

const CONSENSUS_RULE = {
  minVotes: 3,
  allowSingleDissenter: true,
  dissenterMajorityMin: 3,
};

/** Units built by hand because they are not one whole instrument. */
type SpecialUnit = Omit<WorkUnit, 'defaultTarget' | 'sortOrder'>;

/**
 * Replacements for FORMS entries, keyed by the form name they replace.
 * They inherit that entry's target and position in the workflow order.
 */
const REPLACEMENTS: Record<string, SpecialUnit> = {
  ntuh_nhi_core_assistant: {
    unitId: 'core.assistant',
    label: 'Core 助理',
    redcapForm: 'ntuh_nhi_core',
    deepLinkPage: 'ntuh_nhi_core',
    kind: 'field_group',
    completionRule: {
      type: 'required_fields',
      variants: [
        {
          when: "er_arrival == '0'",
          fields: [...CORE_ASSISTANT_REQUIRED_FIELDS],
          checkboxFields: [...CORE_ASSISTANT_CHECKBOX_FIELDS],
        },
        // Carried over verbatim from CORE_ASSISTANT_REQUIRED_FIELDS_NON_ER.
        // Note for review: the comment at src/lib/redcap/client.ts:137 claims
        // this set is `tohospital_core + prehos_rosc_core`, but the constant
        // has only held prehos_rosc_core. The seed preserves the behaviour that
        // has been running; which one is correct is a call for the registry
        // lead to make in the catalog editor.
        { when: 'else', fields: [...CORE_ASSISTANT_REQUIRED_FIELDS_NON_ER] },
      ],
    },
    applicability: { expr: 'true', gatingFields: [] },
    dependencies: [],
    category: 'basic',
  },

  ntuh_nhi_core_doctor: {
    unitId: 'core.doctor',
    label: 'Core 醫師',
    redcapForm: 'ntuh_nhi_core',
    deepLinkPage: 'ntuh_nhi_core',
    kind: 'verify',
    completionRule: { type: 'verify', completeField: 'ntuh_nhi_core_complete' },
    applicability: { expr: 'true', gatingFields: [] },
    // The assistant→doctor handoff, which until now was only a convention.
    dependencies: [{ unitId: 'core.assistant', type: 'verify_after' }],
    category: 'basic',
  },

  ntuh_nhi_outcome_assistant: {
    unitId: 'outcome.assistant',
    label: 'Outcome 助理',
    redcapForm: 'ntuh_nhi_outcome',
    deepLinkPage: 'ntuh_nhi_outcome',
    kind: 'field_group',
    completionRule: {
      type: 'required_fields',
      variants: [{ when: 'else', fields: [...OUTCOME_ASSISTANT_REQUIRED_FIELDS] }],
    },
    applicability: { expr: 'true', gatingFields: [] },
    dependencies: [],
    category: 'basic',
  },

  ntuh_nhi_outcome_doctor: {
    unitId: 'outcome.doctor',
    label: 'Outcome 醫師',
    redcapForm: 'ntuh_nhi_outcome',
    deepLinkPage: 'ntuh_nhi_outcome',
    kind: 'verify',
    completionRule: { type: 'verify', completeField: 'ntuh_nhi_outcome_complete' },
    applicability: { expr: 'true', gatingFields: [] },
    dependencies: [{ unitId: 'outcome.assistant', type: 'verify_after' }],
    category: 'basic',
  },

  ntuh_nhi_outcome_etiology: {
    unitId: 'outcome.etiology',
    label: 'Outcome 死因',
    redcapForm: 'ntuh_nhi_outcome',
    deepLinkPage: 'ntuh_nhi_outcome',
    kind: 'derived_field',
    completionRule: { type: 'derived_field', watchField: 'etiology_final' },
    applicability: { expr: 'true', gatingFields: [] },
    dependencies: [],
    category: 'basic',
  },

  ntuh_nhi_etiology: {
    unitId: 'etiology.vote',
    label: 'Etiology 判讀',
    redcapForm: 'ntuh_nhi_etiology',
    deepLinkPage: 'ntuh_nhi_etiology',
    kind: 'adjudication',
    completionRule: { type: 'adjudication', consensusRule: CONSENSUS_RULE },
    applicability: { expr: 'true', gatingFields: [] },
    dependencies: [],
    category: 'basic',
  },
};

/**
 * Exam forms are gated on the patient's exam checklist.
 *
 * `ntuh_nhi_examcheck` records, per patient, which reports exist in the chart
 * at all — one radio per exam type, `0 沒有 | 1 有(OHCA前) | 2 有(OHCA後) | 3 前後都有`.
 * That answers the question the exam forms' own `_complete` never could: does
 * this form have anything to be entered for this patient? The tri-state does
 * the rest — blank blocks the exam form on the checklist, `0` makes it not
 * applicable, anything else makes it due.
 *
 * Measured before this was wired in: CAG had rows for 6,456 patients while the
 * checklist said 1,342 had a catheterisation. The other five thousand were
 * placeholder rows saying "none" — a workflow from before the checklist
 * existed. The old `target: 1500` was a hand-guess at that 1,342.
 */
const EXAMCHECK_FIELD: Record<string, string> = {
  ntuh_exam_cag: 'cag_examcheck',
  ntuh_exam_ct: 'ct_examcheck',
  ntuh_exam_ucg: 'us_ucg_examcheck',
  ntuh_exam_abd_echo: 'us_abdomen_examcheck',
  ntuh_exam_pes: 'scope_pes_examcheck',
  ntuh_exam_colon: 'scope_colon_examcheck',
  ntuh_nhi_op: 'op_examcheck',
  ntuh_exam_patho: 'patho_examcheck',
  ntuh_exam_lft_2: 'lft_examcheck',
  ntuh_exam_eeg: 'eeg_examcheck',
};

function examGate(field: string): WorkUnit['applicability'] {
  return {
    expr: `${field} != '0'`,
    gatingFields: [{ field, enteredByUnit: 'ntuh_nhi_examcheck', aggregation: 'main' }],
  };
}

/** Applicability rules that live inline in transformCompletion today. */
const APPLICABILITY: Record<string, WorkUnit['applicability']> = {
  ...Object.fromEntries(Object.entries(EXAMCHECK_FIELD).map(([form, field]) => [form, examGate(field)])),

  // In-hospital CPR is recorded per event. A patient who arrived already
  // under a do-not-resuscitate order, or with a pulse (prehospital ROSC — code
  // 2; code 1 is "had ROSC and lost it again", who does need CPR), has no such
  // event, so the form does not apply rather than sitting unfinished forever.
  // Both gates are the core assistant's fields.
  ntuh_nhi_core_cpr: {
    expr: "initial_dnr_core != '1' && prehos_rosc_core != '2'",
    gatingFields: [
      { field: 'initial_dnr_core', enteredByUnit: 'core.assistant', aggregation: 'main' },
      { field: 'prehos_rosc_core', enteredByUnit: 'core.assistant', aggregation: 'main' },
    ],
  },

  ntuh_nhi_lab_icu: {
    expr: "sur_icu == '1'",
    gatingFields: [{ field: 'sur_icu', enteredByUnit: 'outcome.assistant', aggregation: 'main' }],
  },
  ntuh_nhi_postarrest_vital: {
    expr: "sur_icu == '1'",
    gatingFields: [{ field: 'sur_icu', enteredByUnit: 'outcome.assistant', aggregation: 'main' }],
  },
  ntuh_nhi_postarrest_care: {
    expr: "sur_icu == '1'",
    gatingFields: [{ field: 'sur_icu', enteredByUnit: 'outcome.assistant', aggregation: 'main' }],
  },
  h14trauma_ohca_transfusion: {
    expr: "cause_all_etiology_new == '1'",
    // Lives on the etiology vote rows, so it has to be read across repeats:
    // the trauma form applies when any labeler classified the case as trauma.
    gatingFields: [{ field: 'cause_all_etiology_new', enteredByUnit: 'etiology.vote', aggregation: 'any' }],
  },
};

/**
 * Completion rules for the repeating instruments that a plain `_complete` MAX
 * misjudges. Every other full form keeps `complete_field` with the default
 * 'any' fold, which is the old behaviour exactly.
 *
 * Time series (ED labs, ICU labs, post-arrest vitals): there is no moment at
 * which these are "complete", only a discharge after which there will be no
 * more rows. The registry lead's rule is that an applicable patient must have
 * at least one row; beyond that the count is shown, not judged.
 *
 * Event forms (one row per procedure): every row must be complete. Three
 * surgeries with one written up is not a finished surgery form. Measured
 * impact when this was decided: 91 patients on patho, 64 on op, 28 on CPR,
 * six or fewer on each of the rest.
 */
const COMPLETION: Record<string, CompletionRule> = {
  ntuh_nhi_lab_ed: { type: 'instance_count', min: 1 },
  ntuh_nhi_lab_icu: { type: 'instance_count', min: 1 },
  ntuh_nhi_postarrest_vital: { type: 'instance_count', min: 1 },

  ...Object.fromEntries(
    [
      'ntuh_nhi_core_cpr', 'ntuh_exam_cag', 'ntuh_exam_ucg', 'ntuh_exam_abd_echo',
      'ntuh_exam_pes', 'ntuh_exam_colon', 'ntuh_nhi_op', 'ntuh_exam_patho',
      'ntuh_exam_lft_2', 'ntuh_exam_eeg', 'ntuh_exam_ct',
    ].map(form => [
      form,
      { type: 'complete_field', completeField: `${form}_complete`, repeatAggregation: 'all' } satisfies CompletionRule,
    ]),
  ),
};

/**
 * The exclusion decision: every record starts with exclusion empty, which the
 * old pipeline counted as a valid OHCA. Making it a unit gives that decision an
 * owner and a queue instead of leaving unscreened records inflating the totals.
 */
const SCREENING_UNIT: WorkUnit = {
  unitId: 'patient.screening',
  label: '排除判定',
  redcapForm: 'ntuh_nhi_patient',
  deepLinkPage: 'ntuh_nhi_patient',
  kind: 'field_group',
  completionRule: {
    type: 'required_fields',
    variants: [{ when: 'else', fields: ['exclusion'] }],
  },
  applicability: { expr: 'true', gatingFields: [] },
  dependencies: [],
  category: 'basic',
  defaultTarget: 6000,
  sortOrder: 5, // straight after ntuh_nhi_patient
};

export function buildSeedCatalog(): CatalogDoc {
  const units: WorkUnit[] = [];

  FORMS.forEach((form, index) => {
    // FORMS order encodes the abstraction workflow; keep it, leaving gaps so
    // units can be inserted between existing ones without a renumber.
    const sortOrder = index * 10;
    const category = EXAM_FORMS.includes(form.name) ? 'exam' : 'basic';

    const replacement = REPLACEMENTS[form.name];
    if (replacement) {
      units.push({ ...replacement, defaultTarget: form.target, sortOrder });
      return;
    }

    units.push({
      unitId: form.name,
      label: form.label,
      redcapForm: form.name,
      deepLinkPage: form.name,
      kind: 'full_form',
      completionRule: COMPLETION[form.name] ?? { type: 'complete_field', completeField: `${form.name}_complete` },
      applicability: APPLICABILITY[form.name] ?? { expr: 'true', gatingFields: [] },
      dependencies: [],
      category,
      defaultTarget: form.target,
      sortOrder,
    });
  });

  units.push(SCREENING_UNIT);
  units.sort((a, b) => a.sortOrder - b.sortOrder);

  return { units, settings: SEED_SETTINGS };
}

/** Units the seed introduces that have no 1:1 FORMS entry. */
export const SEED_ADDED_UNIT_IDS = [SCREENING_UNIT.unitId];

/** FORMS entries the seed re-shapes rather than carrying over as full_form. */
export const SEED_REPLACED_FORM_NAMES = Object.keys(REPLACEMENTS);

/** Virtual forms from the old config, for parity assertions. */
export const LEGACY_VIRTUAL_FORMS = VIRTUAL_FORMS;

/**
 * Unit id → the forms.ts name it came from.
 *
 * Owner assignments are still keyed by form name, so this is what lets the new
 * state matrix show owners before assignment rules replace that map. Units with
 * no entry (patient.screening) have never had an owner — which is the
 * accountability gap the unit exists to expose.
 */
export const LEGACY_FORM_BY_UNIT_ID: Record<string, string> = Object.fromEntries(
  Object.entries(REPLACEMENTS).map(([formName, unit]) => [unit.unitId, formName]),
);
