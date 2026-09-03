import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProgress, computeUnitTotals, type ProgressPersonRef, type ProgressUnitRef } from './progress.ts';
import type { CellState, RecordDerivation, WorkState } from './types.ts';

/**
 * Unit ids here are absent from the seed's legacy-form map, so they fall
 * through to the identity mapping and the assignment key is the unit id.
 */

const ASSISTANT: ProgressUnitRef = { unitId: 'unit.a', label: '助理表', kind: 'field_group' };
const DOCTOR: ProgressUnitRef = { unitId: 'unit.v', label: '醫師簽核', kind: 'verify' };

const ALICE: ProgressPersonRef = {
  id: 'p-alice', redcapUsername: 'ALICE', displayName: '王小明', email: 'a@ntuh', active: true,
};

function record(studyId: string, cells: Array<{ unitId: string; state: WorkState }>): RecordDerivation {
  return {
    studyId, hospital: 0, excluded: false, screeningPending: false,
    cells: cells.map(c => ({ studyId, ...c }) as CellState),
  };
}

function only(result: ReturnType<typeof computeProgress>) {
  assert.equal(result.length, 1);
  return result[0];
}

test('the denominator is the cells that exist, not a flat batch target', () => {
  // The bug this replaces: 2 of 3 applicable done reads as 66.7%, not as
  // 2/6000 because a target constant said so.
  const progress = only(computeProgress({
    units: [ASSISTANT],
    assignments: { 'unit.a': 'ALICE' },
    people: [ALICE],
    records: [
      record('1', [{ unitId: 'unit.a', state: 'complete' }]),
      record('2', [{ unitId: 'unit.a', state: 'complete' }]),
      record('3', [{ unitId: 'unit.a', state: 'ready' }]),
    ],
  }));
  assert.equal(progress.applicableTotal, 3);
  assert.equal(progress.completedTotal, 2);
  assert.equal(progress.pct, 66.7);
});

test('patients the form does not apply to are in neither half of the fraction', () => {
  const progress = only(computeProgress({
    units: [ASSISTANT],
    assignments: { 'unit.a': 'ALICE' },
    people: [ALICE],
    records: [
      record('1', [{ unitId: 'unit.a', state: 'complete' }]),
      record('2', [{ unitId: 'unit.a', state: 'not_applicable' }]),
      record('3', [{ unitId: 'unit.a', state: 'not_applicable' }]),
    ],
  }));
  assert.equal(progress.applicableTotal, 1);
  assert.equal(progress.pct, 100);
});

test('being blocked by someone upstream cannot lower your score', () => {
  const blockedOnly = only(computeProgress({
    units: [ASSISTANT],
    assignments: { 'unit.a': 'ALICE' },
    people: [ALICE],
    records: [
      record('1', [{ unitId: 'unit.a', state: 'complete' }]),
      record('2', [{ unitId: 'unit.a', state: 'blocked' }]),
      record('3', [{ unitId: 'unit.a', state: 'blocked' }]),
    ],
  }));
  assert.equal(blockedOnly.blockedCount, 2);
  assert.equal(blockedOnly.applicableTotal, 1);
  assert.equal(blockedOnly.pct, 100);
});

test('nothing workable is not zero percent — it is not a score at all', () => {
  const progress = only(computeProgress({
    units: [ASSISTANT],
    assignments: { 'unit.a': 'ALICE' },
    people: [ALICE],
    records: [record('1', [{ unitId: 'unit.a', state: 'blocked' }])],
  }));
  assert.equal(progress.pct, null);
  assert.equal(progress.grade, '無可動工項目');
});

test("an assistant's score does not move with the doctor's signing speed", () => {
  // entered_awaiting_verify means the assistant filled it in full. For them it
  // is done; the wait belongs to the verifier.
  const progress = only(computeProgress({
    units: [ASSISTANT],
    assignments: { 'unit.a': 'ALICE' },
    people: [ALICE],
    records: [
      record('1', [{ unitId: 'unit.a', state: 'entered_awaiting_verify' }]),
      record('2', [{ unitId: 'unit.a', state: 'entered_awaiting_verify' }]),
    ],
  }));
  assert.equal(progress.completedTotal, 2);
  assert.equal(progress.pct, 100);
  assert.equal(progress.awaitingVerifyCount, 2);
});

test('for the verifier the same state is exactly what they still owe', () => {
  const progress = only(computeProgress({
    units: [DOCTOR],
    assignments: { 'unit.v': 'ALICE' },
    people: [ALICE],
    records: [
      record('1', [{ unitId: 'unit.v', state: 'entered_awaiting_verify' }]),
      record('2', [{ unitId: 'unit.v', state: 'complete' }]),
    ],
  }));
  assert.equal(progress.completedTotal, 1);
  assert.equal(progress.pct, 50);
});

test('a low score alone is not 落後 — something must actually be sitting', () => {
  const records = [
    record('1', [{ unitId: 'unit.a', state: 'complete' }]),
    ...Array.from({ length: 9 }, (_, i) => record(String(i + 2), [{ unitId: 'unit.a', state: 'ready' as WorkState }])),
  ];
  const base = {
    units: [ASSISTANT], assignments: { 'unit.a': 'ALICE' }, people: [ALICE], records,
    now: new Date('2026-09-20T00:00:00Z'),
  };

  // 10% done, but everything only became ready yesterday: newly handed over,
  // not neglected.
  const fresh = only(computeProgress({
    ...base,
    readySince: new Map(records.slice(1).map(r => [`${r.studyId}|unit.a`, '2026-09-19T00:00:00Z'])),
  }));
  assert.equal(fresh.pct, 10);
  assert.equal(fresh.oldestReadyDays, 1);
  assert.equal(fresh.grade, '待加強');

  // Same score, but the oldest item has sat for a month.
  const stale = only(computeProgress({
    ...base,
    readySince: new Map(records.slice(1).map(r => [`${r.studyId}|unit.a`, '2026-08-20T00:00:00Z'])),
  }));
  assert.equal(stale.oldestReadyDays, 31);
  assert.equal(stale.grade, '落後');
});

test('the 優/良 thresholds are unchanged', () => {
  const grade = (complete: number, total: number) => only(computeProgress({
    units: [ASSISTANT], assignments: { 'unit.a': 'ALICE' }, people: [ALICE],
    records: Array.from({ length: total }, (_, i) =>
      record(String(i), [{ unitId: 'unit.a', state: i < complete ? 'complete' : 'ready' }])),
  })).grade;

  assert.equal(grade(90, 100), '優');
  assert.equal(grade(89, 100), '良');
  assert.equal(grade(60, 100), '良');
  assert.equal(grade(59, 100), '待加強');
});

test('stalled is orthogonal to the score: behind-but-working differs from stopped', () => {
  const base = {
    units: [ASSISTANT], assignments: { 'unit.a': 'ALICE' }, people: [ALICE],
    records: [record('1', [{ unitId: 'unit.a', state: 'ready' as WorkState }])],
  };

  const working = only(computeProgress({
    ...base,
    activity: new Map([['ALICE', { lastEntryAt: '2026-09-19T00:00:00Z', count: 42 }]]),
  }));
  assert.equal(working.stalled, false);
  assert.equal(working.redcapSaves, 42);

  const stopped = only(computeProgress({ ...base }));
  assert.equal(stopped.stalled, true);
  assert.equal(stopped.lastRedcapActivity, null);
});

test('activity is keyed on the REDCap username, never on a display name', () => {
  // Two people can share a display name; usernames are what REDCap logs.
  const progress = only(computeProgress({
    units: [ASSISTANT], assignments: { 'unit.a': 'ALICE' },
    people: [{ ...ALICE, displayName: '熊墨樺' }],
    records: [record('1', [{ unitId: 'unit.a', state: 'ready' }])],
    activity: new Map([
      ['ALICE', { lastEntryAt: '2026-09-19T00:00:00Z', count: 5 }],
      ['OTHER_SAME_NAME', { lastEntryAt: '2026-01-01T00:00:00Z', count: 999 }],
    ]),
  }));
  assert.equal(progress.redcapSaves, 5);
});

test('one owner across several units is graded on the whole, unit detail kept', () => {
  const progress = only(computeProgress({
    units: [ASSISTANT, DOCTOR],
    assignments: { 'unit.a': 'ALICE', 'unit.v': 'ALICE' },
    people: [ALICE],
    records: [
      record('1', [{ unitId: 'unit.a', state: 'complete' }, { unitId: 'unit.v', state: 'ready' }]),
      record('2', [{ unitId: 'unit.a', state: 'complete' }, { unitId: 'unit.v', state: 'complete' }]),
    ],
  }));
  assert.equal(progress.applicableTotal, 4);
  assert.equal(progress.completedTotal, 3);
  assert.equal(progress.units.length, 2);
  assert.deepEqual(
    progress.units.map(u => `${u.label}:${u.done}/${u.workable}`).sort(),
    ['助理表:2/2', '醫師簽核:1/2'],
  );
});

test('unassigned units contribute to nobody', () => {
  assert.deepEqual(computeProgress({
    units: [ASSISTANT], assignments: {}, people: [ALICE],
    records: [record('1', [{ unitId: 'unit.a', state: 'ready' }])],
  }), []);
});

test('the worst score sorts first, and ungradeable owners sort last', () => {
  const bob: ProgressPersonRef = { ...ALICE, id: 'p-bob', redcapUsername: 'BOB', displayName: '李小華' };
  const result = computeProgress({
    units: [ASSISTANT, DOCTOR],
    assignments: { 'unit.a': 'ALICE', 'unit.v': 'BOB' },
    people: [ALICE, bob],
    records: [
      record('1', [{ unitId: 'unit.a', state: 'ready' }, { unitId: 'unit.v', state: 'complete' }]),
    ],
  });
  assert.deepEqual(result.map(p => p.displayName), ['王小明', '李小華']);
});

/* ── per-unit totals ─────────────────────────────────────── */

test('a form is measured against its own population, not the registry', () => {
  // ICU-only: two patients apply, one is done. Three patients never apply
  // and are counted as such rather than dragging the fraction down.
  const [unit] = computeUnitTotals({
    units: [ASSISTANT], assignments: { 'unit.a': 'ALICE' }, people: [ALICE],
    records: [
      record('1', [{ unitId: 'unit.a', state: 'complete' }]),
      record('2', [{ unitId: 'unit.a', state: 'ready' }]),
      record('3', [{ unitId: 'unit.a', state: 'not_applicable' }]),
      record('4', [{ unitId: 'unit.a', state: 'not_applicable' }]),
      record('5', [{ unitId: 'unit.a', state: 'not_applicable' }]),
    ],
  });
  assert.equal(unit.workable, 2);
  assert.equal(unit.done, 1);
  assert.equal(unit.pct, 50);
  assert.equal(unit.notApplicable, 3);
  assert.equal(unit.owner?.displayName, '王小明');
});

test('an unassigned form still gets a row — that is the row that matters', () => {
  const [unit] = computeUnitTotals({
    units: [ASSISTANT], assignments: {}, people: [],
    records: [record('1', [{ unitId: 'unit.a', state: 'ready' }])],
  });
  assert.equal(unit.owner, null);
  assert.equal(unit.ready, 1);
});

test('a row-counting unit reports rows and patients with rows', () => {
  const labs: ProgressUnitRef & { ruleType: string } = {
    unitId: 'unit.lab', label: 'Lab ICU', kind: 'full_form', ruleType: 'instance_count',
  };
  const [unit] = computeUnitTotals({
    units: [labs], assignments: {}, people: [],
    records: [
      { ...record('1', [{ unitId: 'unit.lab', state: 'complete' }]), cells: [{ studyId: '1', unitId: 'unit.lab', state: 'complete', instances: 27 }] },
      { ...record('2', [{ unitId: 'unit.lab', state: 'ready' }]), cells: [{ studyId: '2', unitId: 'unit.lab', state: 'ready', instances: 0 }] },
      { ...record('3', [{ unitId: 'unit.lab', state: 'not_applicable' }]), cells: [{ studyId: '3', unitId: 'unit.lab', state: 'not_applicable' }] },
    ],
  });
  assert.equal(unit.ruleType, 'instance_count');
  assert.equal(unit.rows, 27);
  assert.equal(unit.patientsWithRows, 1);
  assert.equal(unit.pct, 50);
});

test('units whose cells carry no count report null, not zero', () => {
  const [unit] = computeUnitTotals({
    units: [ASSISTANT], assignments: {}, people: [],
    records: [record('1', [{ unitId: 'unit.a', state: 'complete' }])],
  });
  assert.equal(unit.rows, null);
  assert.equal(unit.patientsWithRows, null);
});

test('the per-person expand and the per-unit table count the same cells', () => {
  const records = [
    record('1', [{ unitId: 'unit.a', state: 'complete' }, { unitId: 'unit.v', state: 'blocked' }]),
    record('2', [{ unitId: 'unit.a', state: 'not_applicable' }, { unitId: 'unit.v', state: 'complete' }]),
  ];
  const input = { units: [ASSISTANT, DOCTOR], assignments: { 'unit.a': 'ALICE', 'unit.v': 'ALICE' }, people: [ALICE], records };
  const [person] = computeProgress(input);
  for (const total of computeUnitTotals(input)) {
    const mine = person.units.find(u => u.unitId === total.unitId)!;
    for (const key of ['ready', 'blocked', 'complete', 'notApplicable', 'workable', 'done'] as const) {
      assert.equal(total[key], mine[key], `${total.unitId}.${key}`);
    }
  }
});
