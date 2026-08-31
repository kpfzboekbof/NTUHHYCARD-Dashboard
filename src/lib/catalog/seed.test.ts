import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeedCatalog } from './seed.ts';
import { FORMS, EXAM_FORMS, VIRTUAL_FORMS } from '@/config/forms';

const catalog = buildSeedCatalog();
const byId = new Map(catalog.units.map(u => [u.unitId, u]));

test('seeds 34 units: 33 forms plus the exclusion decision', () => {
  assert.equal(FORMS.length, 33, 'FORMS changed — update the seed expectations');
  assert.equal(catalog.units.length, 34);
});

test('every catalog form exists as a REDCap instrument', () => {
  // ntuh_exam_holtertreadmill used to sit here: REDCap has no such instrument,
  // so its _complete field read empty for every record and the form was stuck
  // at 0% of a 1000 target forever. The Holter and treadmill answers are radio
  // fields inside ntuh_nhi_examcheck.
  assert.ok(!byId.has('ntuh_exam_holtertreadmill'));
  for (const id of ['ntuh_nhi_ed_vital', 'ntuh_nhi_postarrest_vital', 'ntuh_exam_ct']) {
    assert.ok(byId.has(id), `${id} should be tracked`);
  }
});

test('postarrest vitals are ICU-gated like the other ICU forms', () => {
  // 2034 of 2211 ICU patients have it complete; no non-ICU patient does.
  assert.equal(byId.get('ntuh_nhi_postarrest_vital')!.applicability.expr, "sur_icu == '1'");
});

test('every plain form becomes a full_form unit keyed by its own name', () => {
  const replaced = new Set([...VIRTUAL_FORMS, 'ntuh_nhi_etiology']);
  for (const form of FORMS) {
    if (replaced.has(form.name)) continue;
    const unit = byId.get(form.name);
    assert.ok(unit, `${form.name} missing from the catalog`);
    assert.equal(unit.kind, 'full_form');
    assert.deepEqual(unit.completionRule, {
      type: 'complete_field',
      completeField: `${form.name}_complete`,
    });
    assert.equal(unit.defaultTarget, form.target);
    assert.equal(unit.deepLinkPage, form.name);
  }
});

test('the five hardcoded virtual forms become ordinary catalog rows', () => {
  const splits = ['core.assistant', 'core.doctor', 'outcome.assistant', 'outcome.doctor', 'outcome.etiology'];
  assert.equal(VIRTUAL_FORMS.length, splits.length);
  for (const id of splits) {
    assert.ok(byId.has(id), `${id} missing`);
  }
  // Field-level splits still deep-link to the real instrument.
  assert.equal(byId.get('core.assistant')!.deepLinkPage, 'ntuh_nhi_core');
  assert.equal(byId.get('outcome.etiology')!.deepLinkPage, 'ntuh_nhi_outcome');
});

test('assistant units carry the required-field sets, doctor units the _complete field', () => {
  const assistant = byId.get('core.assistant')!;
  assert.equal(assistant.completionRule.type, 'required_fields');
  if (assistant.completionRule.type === 'required_fields') {
    const [erVariant, fallback] = assistant.completionRule.variants;
    assert.equal(erVariant.when, "er_arrival == '0'");
    assert.ok(erVariant.fields.includes('place_core'));
    assert.deepEqual(erVariant.checkboxFields, ['airway_core']);
    assert.equal(fallback.when, 'else');
    assert.deepEqual(fallback.fields, ['prehos_rosc_core']);
  }

  assert.deepEqual(byId.get('core.doctor')!.completionRule, {
    type: 'verify',
    completeField: 'ntuh_nhi_core_complete',
  });
});

test('the assistant→doctor handoff is a dependency, not a convention', () => {
  assert.deepEqual(byId.get('core.doctor')!.dependencies, [
    { unitId: 'core.assistant', type: 'verify_after' },
  ]);
  assert.deepEqual(byId.get('outcome.doctor')!.dependencies, [
    { unitId: 'outcome.assistant', type: 'verify_after' },
  ]);
});

test('applicability gating matches the rules inlined in transformCompletion', () => {
  for (const id of ['ntuh_nhi_lab_icu', 'ntuh_nhi_postarrest_care']) {
    assert.equal(byId.get(id)!.applicability.expr, "sur_icu == '1'");
  }

  const trauma = byId.get('h14trauma_ohca_transfusion')!;
  assert.equal(trauma.applicability.expr, "cause_all_etiology_new == '1'");
  // Read across repeats or every patient evaluates to unknown.
  assert.equal(trauma.applicability.gatingFields[0].aggregation, 'any');
  assert.equal(trauma.applicability.gatingFields[0].enteredByUnit, 'etiology.vote');
});

test('mtDNA stays applicable to everyone, matching current behaviour', () => {
  assert.equal(byId.get('h20_mtdna')!.applicability.expr, 'true');
});

test('exam forms keep their category so batch targets stay separable', () => {
  for (const name of EXAM_FORMS) {
    assert.equal(byId.get(name)!.category, 'exam', name);
  }
  assert.equal(byId.get('ntuh_nhi_patient')!.category, 'basic');
});

test('unit ids are unique and ordering follows the abstraction workflow', () => {
  assert.equal(byId.size, catalog.units.length, 'duplicate unitId');

  const order = catalog.units.map(u => u.sortOrder);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));

  const ids = catalog.units.map(u => u.unitId);
  assert.ok(ids.indexOf('patient.screening') < ids.indexOf('ntuh_nhi_basic_info_38971b'));
  assert.ok(ids.indexOf('core.assistant') < ids.indexOf('core.doctor'));
});

test('every dependency points at a unit that exists', () => {
  for (const unit of catalog.units) {
    for (const dep of unit.dependencies) {
      assert.ok(byId.has(dep.unitId), `${unit.unitId} depends on unknown ${dep.unitId}`);
    }
  }
});
