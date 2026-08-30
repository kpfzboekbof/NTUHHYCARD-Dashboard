import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRecord, completeValue } from './derive.ts';
import { buildSeedCatalog } from '@/lib/catalog/seed';
import type { RecordSnapshot, WorkState } from './types.ts';
import type { AdjudicationSummary } from './types.ts';

const catalog = buildSeedCatalog();
const units = catalog.units;

function snapshot(main: Record<string, string>, repeats: Record<string, string[]> = {}): RecordSnapshot {
  return { studyId: '5123', main: { exclusion: '0', ...main }, repeats };
}

function statesOf(main: Record<string, string>, repeats?: Record<string, string[]>, adjudication?: AdjudicationSummary) {
  const derived = deriveRecord(snapshot(main, repeats), { units, adjudication });
  const map = new Map<string, WorkState>();
  for (const cell of derived.cells) map.set(cell.unitId, cell.state);
  return { map, derived };
}

function cellOf(unitId: string, main: Record<string, string>, repeats?: Record<string, string[]>) {
  const derived = deriveRecord(snapshot(main, repeats), { units });
  return derived.cells.find(c => c.unitId === unitId)!;
}

/* ── exclusion ───────────────────────────────────────────── */

test('an excluded record has no applicable work', () => {
  const derived = deriveRecord(snapshot({ exclusion: '1' }), { units });
  assert.equal(derived.excluded, true);
  assert.ok(derived.cells.every(c => c.state === 'not_applicable'));
  assert.deepEqual(derived.cells[0].blockReason, { kind: 'excluded' });
});

test('an unscreened record is counted in but flagged as pending', () => {
  // The old pipeline treated empty exclusion as a confirmed OHCA, so records
  // nobody had screened silently inflated the denominator.
  const derived = deriveRecord(snapshot({ exclusion: '' }), { units });
  assert.equal(derived.excluded, false);
  assert.equal(derived.screeningPending, true);

  const screening = derived.cells.find(c => c.unitId === 'patient.screening')!;
  assert.equal(screening.state, 'ready');
});

test('deciding exclusion completes the screening unit', () => {
  const { map, derived } = statesOf({ exclusion: '0' });
  assert.equal(derived.screeningPending, false);
  assert.equal(map.get('patient.screening'), 'complete');
});

/* ── plain forms ─────────────────────────────────────────── */

test('_complete maps to ready / in_progress / complete', () => {
  assert.equal(statesOf({ ntuh_nhi_patient_complete: '0' }).map.get('ntuh_nhi_patient'), 'ready');
  assert.equal(statesOf({ ntuh_nhi_patient_complete: '1' }).map.get('ntuh_nhi_patient'), 'in_progress');
  assert.equal(statesOf({ ntuh_nhi_patient_complete: '2' }).map.get('ntuh_nhi_patient'), 'complete');
  assert.equal(statesOf({}).map.get('ntuh_nhi_patient'), 'ready');
});

test('repeat instruments keep the max _complete, as the old pipeline did', () => {
  const snap = snapshot({ ntuh_nhi_patient_complete: '0' }, { ntuh_nhi_patient_complete: ['0', '2'] });
  assert.equal(completeValue(snap, 'ntuh_nhi_patient_complete'), '2');
});

/* ── applicability ───────────────────────────────────────── */

test('ICU forms do not apply when the patient never reached ICU', () => {
  const { map } = statesOf({ sur_icu: '0' });
  assert.equal(map.get('ntuh_nhi_lab_icu'), 'not_applicable');
  assert.equal(map.get('ntuh_nhi_postarrest_care'), 'not_applicable');
});

test('ICU forms are blocked — not behind — while sur_icu is unanswered', () => {
  // The old heatmap painted this red, indistinguishable from someone falling
  // behind; it is really work nobody can start yet.
  const cell = cellOf('ntuh_nhi_lab_icu', { sur_icu: '' });
  assert.equal(cell.state, 'blocked');
  assert.deepEqual(cell.blockReason, {
    kind: 'awaiting_gate',
    field: 'sur_icu',
    enteredByUnit: 'outcome.assistant',
  });
});

test('ICU forms become ready once sur_icu says the patient was admitted', () => {
  assert.equal(statesOf({ sur_icu: '1' }).map.get('ntuh_nhi_lab_icu'), 'ready');
});

test('the trauma form follows the etiology votes on the repeating rows', () => {
  assert.equal(
    statesOf({}, { cause_all_etiology_new: ['0', '1'] }).map.get('h14trauma_ohca_transfusion'),
    'ready',
  );
  assert.equal(
    statesOf({}, { cause_all_etiology_new: ['0', '0'] }).map.get('h14trauma_ohca_transfusion'),
    'not_applicable',
  );
  assert.equal(
    statesOf({}, {}).map.get('h14trauma_ohca_transfusion'),
    'blocked',
  );
});

/* ── the assistant → doctor handoff ──────────────────────── */

const CORE_FIELDS = {
  er_arrival: '0',
  place_core: '1', witnessed_core: '1', bystander_core: '1', pad_core: '1',
  manual_core: '1', mcc_core: '1', aed_core: '1', airway_core___1: '1',
  bosmin_core: '1', emt_core: '1', emtp_core: '1', prehos_rosc_core: '1',
};

test('an untouched core form is ready for the assistant and blocked for the doctor', () => {
  const { map } = statesOf({ er_arrival: '0' });
  assert.equal(map.get('core.assistant'), 'ready');

  const doctor = cellOf('core.doctor', { er_arrival: '0' });
  assert.equal(doctor.state, 'blocked');
  assert.deepEqual(doctor.blockReason, { kind: 'awaiting_unit', unitId: 'core.assistant' });
});

test('a partly filled core form is in progress and still blocks the doctor', () => {
  const { map } = statesOf({ er_arrival: '0', place_core: '1' });
  assert.equal(map.get('core.assistant'), 'in_progress');
  assert.equal(map.get('core.doctor'), 'blocked');
});

test('finishing the fields hands the record to the doctor', () => {
  // The state that did not exist before: entered, awaiting sign-off, with the
  // doctor's cell becoming actionable at the same moment.
  const { map } = statesOf(CORE_FIELDS);
  assert.equal(map.get('core.assistant'), 'entered_awaiting_verify');
  assert.equal(map.get('core.doctor'), 'ready');
});

test('the doctor signing off completes both sides', () => {
  const { map } = statesOf({ ...CORE_FIELDS, ntuh_nhi_core_complete: '2' });
  assert.equal(map.get('core.assistant'), 'complete');
  assert.equal(map.get('core.doctor'), 'complete');
});

test('a checkbox field counts as filled when any option is ticked', () => {
  const withoutAirway = { ...CORE_FIELDS } as Record<string, string>;
  delete withoutAirway.airway_core___1;
  assert.equal(statesOf(withoutAirway).map.get('core.assistant'), 'in_progress');

  const otherOption = { ...withoutAirway, airway_core___3: '1' };
  assert.equal(statesOf(otherOption).map.get('core.assistant'), 'entered_awaiting_verify');
});

test('a patient who did not arrive by ED needs only the reduced field set', () => {
  const { map } = statesOf({ er_arrival: '1', prehos_rosc_core: '2' });
  assert.equal(map.get('core.assistant'), 'entered_awaiting_verify');
});

test('out-of-order sign-off counts as complete for the doctor only', () => {
  // Nothing in REDCap stops a doctor completing the form before the assistant
  // has entered anything. Reporting the doctor as blocked would understate real
  // work, but the assistant's fields are still empty and their cell says so —
  // the pair is exactly the anomaly the A0 quality check exists to flag.
  const { map } = statesOf({ er_arrival: '0', ntuh_nhi_core_complete: '2' });
  assert.equal(map.get('core.doctor'), 'complete');
  assert.equal(map.get('core.assistant'), 'ready');
});

/* ── etiology and the derived death-cause cell ───────────── */

const GREEN: AdjudicationSummary = { completedVotes: 3, consensus: 'green', mappable: true, finalWritten: false };

test('etiology votes progress from in_progress to awaiting the meeting', () => {
  const tooFew: AdjudicationSummary = { completedVotes: 2, consensus: 'yellow', mappable: false, finalWritten: false };
  assert.equal(statesOf({}, {}, tooFew).map.get('etiology.vote'), 'in_progress');

  const red: AdjudicationSummary = { completedVotes: 4, consensus: 'red', mappable: false, finalWritten: false };
  assert.equal(statesOf({}, {}, red).map.get('etiology.vote'), 'entered_awaiting_verify');

  // Green but unmappable — the case that used to appear once in a modal and
  // then be forgotten. It stays in a queue instead.
  const unmappable: AdjudicationSummary = { completedVotes: 3, consensus: 'green', mappable: false, finalWritten: false };
  assert.equal(statesOf({}, {}, unmappable).map.get('etiology.vote'), 'entered_awaiting_verify');
});

test('the death-cause cell waits for consensus, then becomes uploadable', () => {
  const blocked = cellOf('outcome.etiology', {});
  assert.equal(blocked.state, 'blocked');
  assert.deepEqual(blocked.blockReason, { kind: 'awaiting_consensus' });

  assert.equal(statesOf({}, {}, GREEN).map.get('outcome.etiology'), 'ready');
  assert.equal(statesOf({ etiology_final: '7' }, {}, GREEN).map.get('outcome.etiology'), 'complete');
});

test('a written final answer completes the etiology unit', () => {
  const done: AdjudicationSummary = { ...GREEN, finalWritten: true };
  assert.equal(statesOf({ etiology_final: '7' }, {}, done).map.get('etiology.vote'), 'complete');
});

/* ── purity ──────────────────────────────────────────────── */

test('derivation is pure, so two runs can be diffed for handoff events', () => {
  const input = snapshot(CORE_FIELDS);
  const first = deriveRecord(input, { units });
  const second = deriveRecord(input, { units });
  assert.deepEqual(first, second);
});

test('every unit in the catalog gets exactly one cell', () => {
  const { derived } = statesOf({});
  assert.equal(derived.cells.length, units.length);
  assert.equal(new Set(derived.cells.map(c => c.unitId)).size, units.length);
});
