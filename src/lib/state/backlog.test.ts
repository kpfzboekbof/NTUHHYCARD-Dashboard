import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBacklog, type PersonRef, type UnitRef } from './backlog.ts';
import type { CellState, RecordDerivation, WorkState } from './types.ts';

/**
 * The seed maps unit ids to legacy form names; these tests use unit ids that
 * are not in that map, so they fall through to the identity mapping and the
 * assignment key is the unit id itself.
 */

const UNITS: UnitRef[] = [
  { unitId: 'unit.a', label: 'A 表', deepLinkPage: 'page_a' },
  { unitId: 'unit.b', label: 'B 表', deepLinkPage: 'page_b' },
];

function person(overrides: Partial<PersonRef> & { id: string }): PersonRef {
  return {
    redcapUsername: null,
    displayName: '某人',
    email: 'x@example.com',
    active: true,
    ...overrides,
  };
}

function record(studyId: string, cells: Array<{ unitId: string; state: WorkState }>): RecordDerivation {
  return {
    studyId,
    hospital: 0,
    excluded: false,
    screeningPending: false,
    cells: cells.map(c => ({ studyId, ...c }) as CellState),
  };
}

const ALICE = person({ id: 'p-alice', redcapUsername: 'ALICE', displayName: '王小明', email: 'alice@ntuh' });
const BOB = person({ id: 'p-bob', redcapUsername: 'BOB', displayName: '李小華', email: 'bob@ntuh' });

test('outstanding work is grouped per person, biggest debt first', () => {
  const backlog = computeBacklog({
    units: UNITS,
    assignments: { 'unit.a': 'ALICE', 'unit.b': 'BOB' },
    people: [ALICE, BOB],
    records: [
      record('1', [{ unitId: 'unit.a', state: 'ready' }, { unitId: 'unit.b', state: 'ready' }]),
      record('2', [{ unitId: 'unit.a', state: 'ready' }]),
      record('3', [{ unitId: 'unit.a', state: 'entered_awaiting_verify' }]),
    ],
  });

  assert.equal(backlog.length, 2);
  assert.equal(backlog[0].displayName, '王小明');
  assert.equal(backlog[0].readyCount, 2);
  assert.equal(backlog[0].awaitingCount, 1);
  assert.equal(backlog[0].total, 3);
  assert.equal(backlog[1].total, 1);
});

test('blocked work is never chased — that is the whole point of the state machine', () => {
  const backlog = computeBacklog({
    units: UNITS,
    assignments: { 'unit.a': 'ALICE' },
    people: [ALICE],
    records: [
      record('1', [{ unitId: 'unit.a', state: 'blocked' }]),
      record('2', [{ unitId: 'unit.a', state: 'not_applicable' }]),
      record('3', [{ unitId: 'unit.a', state: 'complete' }]),
      record('4', [{ unitId: 'unit.a', state: 'in_progress' }]),
    ],
  });
  // in_progress is somebody already typing; nothing here is worth a reminder.
  assert.deepEqual(backlog, []);
});

test('a batch cutoff excludes records above it', () => {
  const records = [
    record('100', [{ unitId: 'unit.a', state: 'ready' }]),
    record('500', [{ unitId: 'unit.a', state: 'ready' }]),
    record('5000', [{ unitId: 'unit.a', state: 'ready' }]),
  ];
  const scoped = computeBacklog({
    units: UNITS, assignments: { 'unit.a': 'ALICE' }, people: [ALICE], records,
    scope: { studyIdCutoff: 500 },
  });
  assert.equal(scoped[0].total, 2);

  const unscoped = computeBacklog({ units: UNITS, assignments: { 'unit.a': 'ALICE' }, people: [ALICE], records });
  assert.equal(unscoped[0].total, 3);
});

test('study ids are compared numerically, not as strings', () => {
  // '90' < '100' numerically but sorts after it as text.
  const backlog = computeBacklog({
    units: UNITS, assignments: { 'unit.a': 'ALICE' }, people: [ALICE],
    records: [record('90', [{ unitId: 'unit.a', state: 'ready' }])],
    scope: { studyIdCutoff: 100 },
  });
  assert.equal(backlog[0].total, 1);
});

test('a batch can be scoped to a subset of units', () => {
  const backlog = computeBacklog({
    units: UNITS,
    assignments: { 'unit.a': 'ALICE', 'unit.b': 'ALICE' },
    people: [ALICE],
    records: [record('1', [{ unitId: 'unit.a', state: 'ready' }, { unitId: 'unit.b', state: 'ready' }])],
    scope: { unitIds: ['unit.b'] },
  });
  assert.equal(backlog[0].units.length, 1);
  assert.equal(backlog[0].units[0].unitId, 'unit.b');
});

test('an empty unit list means every unit, so a batch needs only an id and a date', () => {
  const backlog = computeBacklog({
    units: UNITS,
    assignments: { 'unit.a': 'ALICE', 'unit.b': 'ALICE' },
    people: [ALICE],
    records: [record('1', [{ unitId: 'unit.a', state: 'ready' }, { unitId: 'unit.b', state: 'ready' }])],
    scope: { unitIds: [] },
  });
  assert.equal(backlog[0].units.length, 2);
});

test('a name comes from the registry first, the REDCap directory second, the raw username last', () => {
  const directory = new Map([['ALICE', '目錄裡的王小明'], ['CAROL', '林小美']]);
  const backlog = computeBacklog({
    units: [...UNITS, { unitId: 'unit.c', label: 'C 表', deepLinkPage: 'page_c' }],
    assignments: { 'unit.a': 'ALICE', 'unit.b': 'CAROL', 'unit.c': 'NOBODY' },
    people: [ALICE],
    directory,
    records: [record('1', [
      { unitId: 'unit.a', state: 'ready' },
      { unitId: 'unit.b', state: 'ready' },
      { unitId: 'unit.c', state: 'ready' },
    ])],
  });

  const byUsername = new Map(backlog.map(p => [p.username, p]));
  // A registry row wins over the directory: it is the name a human curated.
  assert.equal(byUsername.get('ALICE')!.displayName, '王小明');
  assert.equal(byUsername.get('ALICE')!.nameSource, 'registry');
  // Known to REDCap but never imported: show the real name, no address.
  assert.equal(byUsername.get('CAROL')!.displayName, '林小美');
  assert.equal(byUsername.get('CAROL')!.nameSource, 'directory');
  assert.equal(byUsername.get('CAROL')!.email, null);
  // REDCap has no such account — the assignment itself is stale, and no
  // import will ever fix it.
  assert.equal(byUsername.get('NOBODY')!.displayName, 'NOBODY');
  assert.equal(byUsername.get('NOBODY')!.nameSource, 'unknown');
});

test('an assignment naming an unlinked username still counts, but has nobody to mail', () => {
  // The work is real and the operator must see it; the registry link is what
  // is missing, and reporting zero would hide the backlog entirely.
  const backlog = computeBacklog({
    units: UNITS,
    assignments: { 'unit.a': 'GHOST' },
    people: [ALICE],
    records: [record('1', [{ unitId: 'unit.a', state: 'ready' }])],
  });
  assert.equal(backlog[0].total, 1);
  assert.equal(backlog[0].personId, null);
  assert.equal(backlog[0].email, null);
  assert.equal(backlog[0].displayName, 'GHOST');
});

test('a deactivated person is not a mail target', () => {
  const backlog = computeBacklog({
    units: UNITS,
    assignments: { 'unit.a': 'ALICE' },
    people: [{ ...ALICE, active: false }],
    records: [record('1', [{ unitId: 'unit.a', state: 'ready' }])],
  });
  assert.equal(backlog[0].personId, null);
});

test('unassigned units produce no backlog rows at all', () => {
  const backlog = computeBacklog({
    units: UNITS, assignments: {}, people: [ALICE],
    records: [record('1', [{ unitId: 'unit.a', state: 'ready' }])],
  });
  assert.deepEqual(backlog, []);
});

test("each person's units are ordered by how much is outstanding", () => {
  const backlog = computeBacklog({
    units: UNITS,
    assignments: { 'unit.a': 'ALICE', 'unit.b': 'ALICE' },
    people: [ALICE],
    records: [
      record('1', [{ unitId: 'unit.b', state: 'ready' }]),
      record('2', [{ unitId: 'unit.b', state: 'ready' }]),
      record('3', [{ unitId: 'unit.a', state: 'ready' }]),
    ],
  });
  assert.deepEqual(backlog[0].units.map(u => u.unitId), ['unit.b', 'unit.a']);
});
