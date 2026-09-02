import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByBlocker, groupByBlockerPerOwner, type BlockerUnitRef } from './blockers.ts';
import type { PersonRef } from './ownership.ts';
import type { BlockReason, CellState, RecordDerivation, WorkState } from './types.ts';

const CT: BlockerUnitRef = { unitId: 'unit.ct', label: 'CT' };
const ICU: BlockerUnitRef = { unitId: 'unit.icu', label: 'Lab ICU' };
const CORE: BlockerUnitRef = { unitId: 'unit.core', label: 'Core' };

const ALICE: PersonRef = {
  id: 'p-alice', redcapUsername: 'ALICE', displayName: '王小明', email: 'a@ntuh', active: true,
};

function record(
  studyId: string,
  cells: Array<{ unitId: string; state: WorkState; blockReason?: BlockReason }>,
): RecordDerivation {
  return {
    studyId, hospital: 0, excluded: false, screeningPending: false,
    cells: cells.map(c => ({ studyId, ...c }) as CellState),
  };
}

const gate = (field: string, enteredByUnit: string): BlockReason =>
  ({ kind: 'awaiting_gate', field, enteredByUnit });

test('blocked work is grouped by whoever has to move first, biggest group first', () => {
  const groups = groupByBlocker({
    units: [CT, ICU, CORE],
    assignments: { 'unit.core': 'ALICE' },
    people: [ALICE],
    records: [
      record('1', [{ unitId: 'unit.icu', state: 'blocked', blockReason: gate('sur_icu', 'unit.core') }]),
      record('2', [{ unitId: 'unit.icu', state: 'blocked', blockReason: gate('sur_icu', 'unit.core') }]),
      record('3', [{ unitId: 'unit.ct', state: 'blocked', blockReason: { kind: 'awaiting_consensus' } }]),
    ],
  });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].label, '等 sur_icu（王小明）');
  assert.equal(groups[0].owner?.personId, 'p-alice', 'the reminder button needs somebody to mail');
  assert.equal(groups[1].label, '等 etiology 共識');
  assert.equal(groups[1].owner, null, 'a meeting is not a person');
});

test('a blocker nobody is assigned to is named as unassigned, not hidden', () => {
  const [group] = groupByBlocker({
    units: [ICU, CORE], assignments: {}, people: [],
    records: [record('1', [{ unitId: 'unit.icu', state: 'blocked', blockReason: gate('sur_icu', 'unit.core') }])],
  });
  assert.equal(group.label, '等 sur_icu（未指派）');
  assert.equal(group.owner, null);
});

test('the units waiting behind a blocker are listed, largest first', () => {
  const groups = groupByBlocker({
    units: [CT, ICU, CORE],
    assignments: { 'unit.core': 'ALICE' }, people: [ALICE],
    records: [
      record('1', [
        { unitId: 'unit.icu', state: 'blocked', blockReason: gate('sur_icu', 'unit.core') },
        { unitId: 'unit.ct', state: 'blocked', blockReason: gate('sur_icu', 'unit.core') },
      ]),
      record('2', [{ unitId: 'unit.icu', state: 'blocked', blockReason: gate('sur_icu', 'unit.core') }]),
    ],
  });
  assert.deepEqual(groups[0].waitingUnits, [
    { unitId: 'unit.icu', label: 'Lab ICU', count: 2 },
    { unitId: 'unit.ct', label: 'CT', count: 1 },
  ]);
});

test('waiting on a whole unit is labelled with that unit, not its id', () => {
  const [group] = groupByBlocker({
    units: [CT, CORE],
    assignments: { 'unit.core': 'ALICE' }, people: [ALICE],
    records: [record('1', [
      { unitId: 'unit.ct', state: 'blocked', blockReason: { kind: 'awaiting_unit', unitId: 'unit.core' } },
    ])],
  });
  assert.equal(group.label, '等 Core（王小明）');
  assert.equal(group.blockingUnitLabel, 'Core');
});

test('two reasons naming different fields stay separate groups', () => {
  const groups = groupByBlocker({
    units: [CT, ICU, CORE], assignments: {}, people: [],
    records: [
      record('1', [{ unitId: 'unit.icu', state: 'blocked', blockReason: gate('sur_icu', 'unit.core') }]),
      record('2', [{ unitId: 'unit.icu', state: 'blocked', blockReason: gate('er_arrival', 'unit.core') }]),
    ],
  });
  assert.equal(groups.length, 2);
});

test('a catalog problem is called one, not blamed on a person', () => {
  const [group] = groupByBlocker({
    units: [CT], assignments: { 'unit.ct': 'ALICE' }, people: [ALICE],
    records: [record('1', [
      { unitId: 'unit.ct', state: 'blocked', blockReason: { kind: 'awaiting_config', detail: '目錄中沒有單元 x' } },
    ])],
  });
  assert.equal(group.label, '目錄設定問題：目錄中沒有單元 x');
  assert.equal(group.owner, null);
});

test('scoping to one owner shows only what is blocking their work', () => {
  const records = [
    record('1', [{ unitId: 'unit.ct', state: 'blocked', blockReason: gate('sur_icu', 'unit.core') }]),
    record('2', [{ unitId: 'unit.icu', state: 'blocked', blockReason: gate('sur_icu', 'unit.core') }]),
  ];
  const base = {
    units: [CT, ICU, CORE],
    assignments: { 'unit.ct': 'BOB', 'unit.icu': 'CAROL', 'unit.core': 'ALICE' },
    people: [ALICE], records,
  };
  assert.equal(groupByBlocker(base)[0].count, 2);
  assert.equal(groupByBlocker({ ...base, forUsername: 'BOB' })[0].count, 1);
  assert.deepEqual(groupByBlocker({ ...base, forUsername: 'NOBODY' }), []);
});

test('samples are capped so a group of thousands stays a summary', () => {
  const [group] = groupByBlocker({
    units: [ICU, CORE], assignments: {}, people: [],
    records: Array.from({ length: 20 }, (_, i) =>
      record(String(i), [{ unitId: 'unit.icu', state: 'blocked', blockReason: gate('sur_icu', 'unit.core') }])),
    sampleSize: 3,
  });
  assert.equal(group.count, 20);
  assert.deepEqual(group.sampleStudyIds, ['0', '1', '2']);
});

test('only blocked cells count — ready and complete work is not a blocker', () => {
  assert.deepEqual(groupByBlocker({
    units: [CT], assignments: { 'unit.ct': 'ALICE' }, people: [ALICE],
    records: [record('1', [{ unitId: 'unit.ct', state: 'ready' }, { unitId: 'unit.ct', state: 'complete' }])],
  }), []);
});

test('the per-owner split says exactly what asking one owner at a time says', () => {
  // The route takes the split because re-walking 200k cells per person is a
  // couple of million wasted iterations — it must not also change the answer.
  const input = {
    units: [CT, ICU, CORE],
    assignments: { 'unit.ct': 'BOB', 'unit.icu': 'CAROL', 'unit.core': 'ALICE' },
    people: [ALICE],
    records: [
      record('1', [
        { unitId: 'unit.ct', state: 'blocked' as WorkState, blockReason: gate('sur_icu', 'unit.core') },
        { unitId: 'unit.icu', state: 'blocked' as WorkState, blockReason: { kind: 'awaiting_consensus' } as BlockReason },
      ]),
      record('2', [{ unitId: 'unit.icu', state: 'blocked' as WorkState, blockReason: gate('sur_icu', 'unit.core') }]),
    ],
  };

  const split = groupByBlockerPerOwner(input);
  assert.deepEqual([...split.keys()].sort(), ['BOB', 'CAROL']);
  for (const username of ['BOB', 'CAROL']) {
    assert.deepEqual(split.get(username), groupByBlocker({ ...input, forUsername: username }), username);
  }
});

test('cells on unassigned units are in the whole-registry view but nobody’s drill-down', () => {
  const input = {
    units: [CT, CORE], assignments: {}, people: [],
    records: [record('1', [{ unitId: 'unit.ct', state: 'blocked' as WorkState, blockReason: gate('sur_icu', 'unit.core') }])],
  };
  assert.equal(groupByBlocker(input)[0].count, 1);
  assert.equal(groupByBlockerPerOwner(input).size, 0);
});
