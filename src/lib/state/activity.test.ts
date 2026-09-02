import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeCredit, collectSaveEvents, lastSaverByRecordForm,
  summarizeActivity, type CreditUnitRef,
} from './activity.ts';
import type { CellState, RecordDerivation, WorkState } from './types.ts';
import type { LogEntry } from '../../types/index.ts';

/**
 * Unit ids here are absent from the seed's legacy-form map, so the assignment
 * key is the unit id itself.
 */

const CT: CreditUnitRef = {
  unitId: 'unit.ct', label: 'CT', kind: 'full_form', redcapForm: 'ntuh_exam_ct',
};
const CORE_ASSISTANT: CreditUnitRef = {
  unitId: 'unit.core.a', label: 'Core 助理', kind: 'field_group', redcapForm: 'ntuh_nhi_core',
};
const CORE_DOCTOR: CreditUnitRef = {
  unitId: 'unit.core.d', label: 'Core 醫師', kind: 'verify', redcapForm: 'ntuh_nhi_core',
};

function log(overrides: Partial<LogEntry> & { username: string }): LogEntry {
  return {
    timestamp: '2026-09-01 10:00', action: 'Update record', details: '',
    record: '1', ...overrides,
  };
}

function record(studyId: string, cells: Array<{ unitId: string; state: WorkState }>): RecordDerivation {
  return {
    studyId, hospital: 0, excluded: false, screeningPending: false,
    cells: cells.map(c => ({ studyId, ...c }) as CellState),
  };
}

test('unparseable or record-less log lines are dropped, not counted as saves', () => {
  const events = collectSaveEvents([
    log({ username: 'A' }),
    log({ username: 'A', record: undefined }),
    log({ username: 'A', timestamp: 'not a date' }),
    log({ username: '' }),
  ]);
  assert.equal(events.length, 1);
});

test('activity is tallied per username — two accounts are two people here', () => {
  // 熊墨樺 holds g07470 and mohua0820. The display-name reverse lookup this
  // replaces kept whichever it saw first and dropped the other outright.
  const { byUsername } = summarizeActivity([
    log({ username: 'g07470', timestamp: '2026-09-01 09:00' }),
    log({ username: 'mohua0820', timestamp: '2026-09-01 11:00' }),
    log({ username: 'mohua0820', timestamp: '2026-09-02 11:00' }),
  ], { now: new Date('2026-09-02T12:00:00+08:00') });

  assert.equal(byUsername.get('g07470')?.count, 1);
  assert.equal(byUsername.get('mohua0820')?.count, 2);
});

test('the window bounds the count but never the last-seen timestamp', () => {
  // Someone who stopped two months ago and someone absent from the export
  // entirely both have zero recent saves, and need different follow-up.
  const { byUsername } = summarizeActivity([
    log({ username: 'OLD', timestamp: '2026-07-01 09:00' }),
    log({ username: 'OLD', timestamp: '2026-07-02 09:00' }),
  ], { now: new Date('2026-09-02T12:00:00+08:00'), windowDays: 14 });

  const old = byUsername.get('OLD')!;
  assert.equal(old.count, 0, 'nothing inside the window');
  assert.equal(old.lastEntryAt, '2026-07-02T01:00:00.000Z', 'but we still know when');
  assert.equal(byUsername.has('NEVER'), false);
});

test('the export start says how far back any of this can see', () => {
  const { exportStart } = summarizeActivity([
    log({ username: 'A', timestamp: '2026-08-15 09:00' }),
    log({ username: 'B', timestamp: '2026-06-01 09:00' }),
  ]);
  assert.equal(exportStart, '2026-06-01T01:00:00.000Z');
});

test('the last saver of a record+form wins, and forms do not bleed together', () => {
  const last = lastSaverByRecordForm([
    log({ username: 'A', record: '1', formParsed: 'ntuh_exam_ct', timestamp: '2026-09-01 09:00' }),
    log({ username: 'B', record: '1', formParsed: 'ntuh_exam_ct', timestamp: '2026-09-01 15:00' }),
    log({ username: 'C', record: '1', formParsed: 'ntuh_nhi_core', timestamp: '2026-09-01 12:00' }),
    log({ username: 'D', record: '2', formParsed: 'ntuh_exam_ct', timestamp: '2026-09-01 12:00' }),
    log({ username: 'E', record: '1', timestamp: '2026-09-01 23:00' }),
  ]);
  assert.equal(last.get('1|ntuh_exam_ct')?.username, 'B');
  assert.equal(last.get('1|ntuh_nhi_core')?.username, 'C');
  assert.equal(last.get('2|ntuh_exam_ct')?.username, 'D');
  assert.equal(last.size, 3, 'a save that named no form is not a form attribution');
});

test('work the owner did themselves is credited to them', () => {
  const summary = attributeCredit({
    units: [CT],
    assignments: { 'unit.ct': 'ALICE' },
    records: [
      record('1', [{ unitId: 'unit.ct', state: 'complete' }]),
      record('2', [{ unitId: 'unit.ct', state: 'complete' }]),
    ],
    logs: [
      log({ username: 'ALICE', record: '1', formParsed: 'ntuh_exam_ct' }),
      log({ username: 'ALICE', record: '2', formParsed: 'ntuh_exam_ct' }),
    ],
  });
  const credit = summary.byOwner.get('ALICE')!;
  assert.equal(credit.completed, 2);
  assert.equal(credit.selfSaved, 2);
  assert.equal(credit.otherSaved, 0);
});

test('work somebody else did is named, not quietly credited to the owner', () => {
  const summary = attributeCredit({
    units: [CT],
    assignments: { 'unit.ct': 'ALICE' },
    records: [
      record('1', [{ unitId: 'unit.ct', state: 'complete' }]),
      record('2', [{ unitId: 'unit.ct', state: 'complete' }]),
      record('3', [{ unitId: 'unit.ct', state: 'complete' }]),
    ],
    logs: [
      log({ username: 'ALICE', record: '1', formParsed: 'ntuh_exam_ct' }),
      log({ username: 'BOB', record: '2', formParsed: 'ntuh_exam_ct' }),
      log({ username: 'BOB', record: '3', formParsed: 'ntuh_exam_ct' }),
    ],
  });
  const credit = summary.byOwner.get('ALICE')!;
  assert.equal(credit.selfSaved, 1);
  assert.equal(credit.otherSaved, 2);
  assert.deepEqual(credit.otherSavers, [{ username: 'BOB', count: 2 }]);
});

test('two units on one instrument are reported unknown rather than guessed', () => {
  // The doctor's sign-off is always the later save on ntuh_nhi_core, so
  // attributing by form would flag every assistant as not doing their own work.
  const summary = attributeCredit({
    units: [CORE_ASSISTANT, CORE_DOCTOR],
    assignments: { 'unit.core.a': 'ALICE', 'unit.core.d': 'DOC' },
    records: [record('1', [
      { unitId: 'unit.core.a', state: 'complete' },
      { unitId: 'unit.core.d', state: 'complete' },
    ])],
    logs: [log({ username: 'DOC', record: '1', formParsed: 'ntuh_nhi_core' })],
  });
  const alice = summary.byOwner.get('ALICE')!;
  assert.equal(alice.completed, 1);
  assert.equal(alice.sharedForm, 1);
  assert.equal(alice.otherSaved, 0);
  assert.equal(alice.selfSaved, 0);
});

test('a cell finished before the log window is unattributed, not misattributed', () => {
  const summary = attributeCredit({
    units: [CT],
    assignments: { 'unit.ct': 'ALICE' },
    records: [record('1', [{ unitId: 'unit.ct', state: 'complete' }])],
    logs: [log({ username: 'BOB', record: '9', formParsed: 'ntuh_exam_ct' })],
  });
  const credit = summary.byOwner.get('ALICE')!;
  assert.equal(credit.unattributed, 1);
  assert.equal(credit.otherSaved, 0);
  assert.equal(summary.exportStart, '2026-09-01T02:00:00.000Z');
});

test('every completed cell lands in exactly one bucket', () => {
  const summary = attributeCredit({
    units: [CT, CORE_ASSISTANT, CORE_DOCTOR],
    assignments: { 'unit.ct': 'ALICE', 'unit.core.a': 'ALICE', 'unit.core.d': 'DOC' },
    records: [
      record('1', [{ unitId: 'unit.ct', state: 'complete' }, { unitId: 'unit.core.a', state: 'complete' }]),
      record('2', [{ unitId: 'unit.ct', state: 'complete' }]),
      record('3', [{ unitId: 'unit.ct', state: 'complete' }]),
    ],
    logs: [
      log({ username: 'ALICE', record: '1', formParsed: 'ntuh_exam_ct' }),
      log({ username: 'BOB', record: '2', formParsed: 'ntuh_exam_ct' }),
    ],
  });
  const c = summary.byOwner.get('ALICE')!;
  assert.equal(c.selfSaved + c.otherSaved + c.unattributed + c.sharedForm, c.completed);
  assert.equal(c.completed, 4);
});

test('an assistant unit counts as finished at entered_awaiting_verify, a verify unit does not', () => {
  const summary = attributeCredit({
    units: [CORE_ASSISTANT, CORE_DOCTOR],
    assignments: { 'unit.core.a': 'ALICE', 'unit.core.d': 'DOC' },
    records: [record('1', [
      { unitId: 'unit.core.a', state: 'entered_awaiting_verify' },
      { unitId: 'unit.core.d', state: 'entered_awaiting_verify' },
    ])],
    logs: [],
  });
  assert.equal(summary.byOwner.get('ALICE')?.completed, 1);
  assert.equal(summary.byOwner.has('DOC'), false);
});

test('saves that named no instrument are counted as the blind spot they are', () => {
  const summary = attributeCredit({
    units: [CT], assignments: { 'unit.ct': 'ALICE' }, records: [],
    logs: [
      log({ username: 'ALICE', record: '1', formParsed: 'ntuh_exam_ct' }),
      log({ username: 'ALICE', record: '2' }),
      log({ username: 'ALICE', record: '3' }),
    ],
  });
  assert.equal(summary.attributableSaves, 1);
  assert.equal(summary.formlessSaves, 2);
});

test('unassigned units credit nobody', () => {
  const summary = attributeCredit({
    units: [CT], assignments: {},
    records: [record('1', [{ unitId: 'unit.ct', state: 'complete' }])],
    logs: [log({ username: 'ALICE', record: '1', formParsed: 'ntuh_exam_ct' })],
  });
  assert.equal(summary.byOwner.size, 0);
});
