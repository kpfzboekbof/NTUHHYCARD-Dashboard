import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packCompletion, unpackCompletion } from './completion-codec.ts';
import { transformCompletion } from './transform.ts';
import type { RawCompletionRecord } from './types.ts';
import { FORMS } from '@/config/forms';

function record(studyId: string, overrides: Partial<RawCompletionRecord> = {}): RawCompletionRecord {
  const base: RawCompletionRecord = {
    study_id: studyId,
    hospital: '0',
    exclusion: '0',
    sur_icu: '0',
    ...overrides,
  };
  return base;
}

test('round-trips the rows transformCompletion produces, in the same order', () => {
  const raw = [
    // Non-ICU patient in 總院: the ICU-dependent forms produce no row.
    record('1001', { ntuh_nhi_patient_complete: '2', ntuh_nhi_predisease_complete: '1' }),
    // ICU patient in 新竹 (code 3 → 新竹), excluded.
    record('1002', { hospital: '3', exclusion: '1', sur_icu: '1', ntuh_nhi_lab_icu_complete: '2', ntuh_nhi_core_complete: '1' }),
    // Unknown hospital code falls back to 院區N.
    record('1003', { hospital: '9', ntuh_nhi_discharge_complete: '2' }),
  ];
  const assignments = { ntuh_nhi_patient: 'alice', ntuh_nhi_lab_icu: 'bob' };
  const users = [{ username: 'alice', name: '愛麗絲' }];
  const virtual = {
    coreAssistant: new Map([['1001', true]]),
    outcomeAssistant: new Map([['1002', true]]),
    outcomeEtiologyFinal: new Map([['1003', true]]),
  };
  const rows = transformCompletion(raw, assignments, users, virtual, new Set(['1002']));

  const packed = packCompletion(rows);
  assert.deepEqual(unpackCompletion(packed), rows);

  // The forms are listed in catalog order, not first-seen order.
  const order = packed.forms.map(f => FORMS.findIndex(x => x.name === f.form));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('a form that applies to no record is simply absent', () => {
  const rows = transformCompletion([record('1')], {}, [], undefined, new Set());
  const packed = packCompletion(rows);
  assert.ok(!packed.forms.some(f => f.form === 'h14trauma_ohca_transfusion'));
  assert.ok(!packed.forms.some(f => f.form === 'ntuh_nhi_lab_icu'));
  assert.equal(packed.records.length, 1);
  assert.equal(packed.records[0][3].length, packed.forms.length);
});

test('not-applicable cells are marked and skipped on unpack', () => {
  const rows = transformCompletion(
    [record('1', { sur_icu: '1' }), record('2')],
    {}, [], undefined, new Set(),
  );
  const packed = packCompletion(rows);
  const icuIndex = packed.forms.findIndex(f => f.form === 'ntuh_nhi_lab_icu');
  assert.notEqual(icuIndex, -1);
  assert.equal(packed.records[0][3][icuIndex], '0');
  assert.equal(packed.records[1][3][icuIndex], '-');
  assert.deepEqual(unpackCompletion(packed), rows);
});

test('the packed form is an order of magnitude smaller than the rows', () => {
  const raw = Array.from({ length: 500 }, (_, i) => record(String(1000 + i), { ntuh_nhi_patient_complete: '2' }));
  const rows = transformCompletion(raw, {}, [], undefined, new Set());
  const packedBytes = JSON.stringify(packCompletion(rows)).length;
  const rowBytes = JSON.stringify(rows).length;
  assert.ok(packedBytes * 10 < rowBytes, `packed ${packedBytes} vs rows ${rowBytes}`);
});

test('empty input round-trips to empty output', () => {
  assert.deepEqual(unpackCompletion(packCompletion([])), []);
  assert.deepEqual(packCompletion([]), { forms: [], records: [] });
});
