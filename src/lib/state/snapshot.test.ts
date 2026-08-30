import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshots, catalogFieldSet } from './snapshot.ts';
import { buildSeedCatalog } from '@/lib/catalog/seed';

test('field set covers every field the catalog reads', () => {
  const fields = new Set(catalogFieldSet(buildSeedCatalog()));

  // Identity and screening
  assert.ok(fields.has('study_id'));
  assert.ok(fields.has('hospital'));
  assert.ok(fields.has('exclusion'));

  // Completion fields, including the ones behind the virtual splits
  assert.ok(fields.has('ntuh_nhi_patient_complete'));
  assert.ok(fields.has('ntuh_nhi_core_complete'));
  assert.ok(fields.has('ntuh_nhi_outcome_complete'));
  assert.ok(fields.has('etiology_final'));

  // Required fields of the assistant groups
  assert.ok(fields.has('place_core'));
  assert.ok(fields.has('airway_core'));
  assert.ok(fields.has('ini_dnr'));

  // Applicability gates
  assert.ok(fields.has('sur_icu'));
  assert.ok(fields.has('cause_all_etiology_new'));

  // Read only by a variant condition — the easiest field to forget, and the
  // one that decides which prehospital fields the assistant owes.
  assert.ok(fields.has('er_arrival'));
});

test('field set is sorted and deduplicated', () => {
  const fields = catalogFieldSet(buildSeedCatalog());
  assert.deepEqual(fields, [...new Set(fields)].sort());
});

test('main-row values land in main, repeat rows accumulate', () => {
  const [snapshot] = buildSnapshots([
    { study_id: '1', redcap_repeat_instrument: '', hospital: '0', exclusion: '0' },
    { study_id: '1', redcap_repeat_instrument: 'ntuh_nhi_etiology', labeler: '3', cause_all_etiology_new: '1' },
    { study_id: '1', redcap_repeat_instrument: 'ntuh_nhi_etiology', labeler: '5', cause_all_etiology_new: '0' },
  ]);

  assert.equal(snapshot.studyId, '1');
  assert.equal(snapshot.main.hospital, '0');
  assert.deepEqual(snapshot.repeats.cause_all_etiology_new, ['1', '0']);
  // Repeat values never leak into the main row.
  assert.equal(snapshot.main.cause_all_etiology_new, undefined);
});

test('records are grouped by study id', () => {
  const snapshots = buildSnapshots([
    { study_id: '1', redcap_repeat_instrument: '', exclusion: '0' },
    { study_id: '2', redcap_repeat_instrument: '', exclusion: '1' },
    { study_id: '1', redcap_repeat_instrument: 'x', note: 'a' },
  ]);

  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots.map(s => s.studyId), ['1', '2']);
});

test('rows without a study id are skipped', () => {
  assert.deepEqual(buildSnapshots([{ study_id: '', hospital: '0' }]), []);
});

test('redcap bookkeeping columns are not treated as data', () => {
  const [snapshot] = buildSnapshots([
    { study_id: '1', redcap_repeat_instrument: '', redcap_repeat_instance: '', hospital: '0' },
  ]);
  assert.deepEqual(Object.keys(snapshot.main).sort(), ['hospital', 'study_id']);
});
