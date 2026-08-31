import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffMatrices } from './diff.ts';
import type { CellState, RecordDerivation, WorkState } from './types.ts';

function record(studyId: string, cells: Array<Partial<CellState> & { unitId: string; state: WorkState }>): RecordDerivation {
  return {
    studyId,
    hospital: 1,
    excluded: false,
    screeningPending: false,
    cells: cells.map(c => ({ studyId, ...c })),
  };
}

test('the canonical handoff: a gate clears and the cause names what was cleared', () => {
  const before = [record('5123', [{
    unitId: 'lab.icu', state: 'blocked',
    blockReason: { kind: 'awaiting_gate', field: 'sur_icu', enteredByUnit: 'outcome.assistant' },
  }])];
  const after = [record('5123', [{ unitId: 'lab.icu', state: 'ready' }])];

  const events = diffMatrices(before, after);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'became_ready');
  assert.equal(events[0].fromState, 'blocked');
  assert.deepEqual(events[0].cause, {
    cleared: { kind: 'awaiting_gate', field: 'sur_icu', enteredByUnit: 'outcome.assistant' },
  });
});

test('the assistant finishing surfaces as the doctor-side handoff', () => {
  const before = [record('1', [{ unitId: 'core.assistant', state: 'in_progress' }])];
  const after = [record('1', [{ unitId: 'core.assistant', state: 'entered_awaiting_verify' }])];
  assert.equal(diffMatrices(before, after)[0].eventType, 'entered_awaiting_verify');
});

test('no change means no events, whatever the state', () => {
  const same = [record('1', [
    { unitId: 'a', state: 'complete' },
    { unitId: 'b', state: 'blocked', blockReason: { kind: 'awaiting_unit', unitId: 'a' } },
    { unitId: 'c', state: 'ready' },
  ])];
  assert.deepEqual(diffMatrices(same, same), []);
});

test('sliding backwards is a regression, not a fresh start', () => {
  const before = [record('1', [{ unitId: 'a', state: 'complete' }])];
  const after = [record('1', [{ unitId: 'a', state: 'in_progress' }])];
  const [event] = diffMatrices(before, after);
  assert.equal(event.eventType, 'regressed');
  assert.equal(event.fromState, 'complete');
  assert.equal(event.toState, 'in_progress');
});

test('gating data changing underneath is its own event, never a regression', () => {
  // sur_icu corrected from 1 to empty: ready → blocked is the gate closing.
  const before = [record('1', [{ unitId: 'lab.icu', state: 'ready' }])];
  const after = [record('1', [{
    unitId: 'lab.icu', state: 'blocked',
    blockReason: { kind: 'awaiting_gate', field: 'sur_icu', enteredByUnit: 'outcome.assistant' },
  }])];
  const [event] = diffMatrices(before, after);
  assert.equal(event.eventType, 'became_blocked');
  assert.deepEqual(event.cause, {
    blockedOn: { kind: 'awaiting_gate', field: 'sur_icu', enteredByUnit: 'outcome.assistant' },
  });
});

test('someone starting to type is visible in the queue but is not a handoff', () => {
  const before = [record('1', [{ unitId: 'a', state: 'ready' }])];
  const after = [record('1', [{ unitId: 'a', state: 'in_progress' }])];
  assert.deepEqual(diffMatrices(before, after), []);
});

test('a brand-new record announces only what is actionable', () => {
  const after = [record('9000', [
    { unitId: 'a', state: 'ready' },
    { unitId: 'b', state: 'not_applicable' },
    { unitId: 'c', state: 'complete' },
    { unitId: 'd', state: 'blocked', blockReason: { kind: 'awaiting_unit', unitId: 'a' } },
    { unitId: 'e', state: 'entered_awaiting_verify' },
  ])];
  const events = diffMatrices([], after);
  assert.deepEqual(
    events.map(e => `${e.unitId}:${e.eventType}`).sort(),
    ['a:became_ready', 'e:entered_awaiting_verify'],
  );
});

test('completion is recorded, so turnaround can be computed later', () => {
  const before = [record('1', [{ unitId: 'a', state: 'entered_awaiting_verify' }])];
  const after = [record('1', [{ unitId: 'a', state: 'complete' }])];
  assert.equal(diffMatrices(before, after)[0].eventType, 'completed');
});

test('a record leaving the registry emits became_na for its formerly live cells', () => {
  const before = [record('1', [{ unitId: 'a', state: 'ready' }])];
  const after = [record('1', [{ unitId: 'a', state: 'not_applicable' }])];
  assert.equal(diffMatrices(before, after)[0].eventType, 'became_na');
});
