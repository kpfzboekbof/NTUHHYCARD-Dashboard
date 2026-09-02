import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcLoggingStats, transformLogs } from './transform.ts';
import type { CompletionRow, LogEntry, User } from '../../types/index.ts';

/**
 * These pin the join between REDCap's log and the people named on the forms.
 * It used to run backwards, from a display name to a single username.
 */

const USERS: User[] = [
  { username: 'g07470', name: '熊墨樺' },
  { username: 'mohua0820', name: '熊墨樺' },
  { username: 'g03360', name: '范程羿' },
];

const ASSIGNMENTS = { ntuh_nhi_patient: 'g07470' };

function row(overrides: Partial<CompletionRow> = {}): CompletionRow {
  return {
    studyId: '1', hospital: 0, hospitalName: '台大',
    form: 'ntuh_nhi_patient', label: 'Patient', owner: '熊墨樺',
    statusCode: 2, status: 'Complete', excluded: false, ...overrides,
  };
}

function log(username: string, timestamp: string): LogEntry {
  return { timestamp, username, action: 'Update record', details: '', record: '1' };
}

test('a person holding two REDCap accounts has both counted, not one dropped', () => {
  // 熊墨樺 really does hold g07470 and mohua0820. The reverse lookup kept
  // whichever account the assignments object happened to list first, so half
  // of this person's work simply did not appear.
  const { byOwner } = calcLoggingStats(
    [log('g07470', '2026-09-01 10:00'), log('mohua0820', '2026-09-01 11:00')],
    [row()], 3, ASSIGNMENTS, USERS,
  );
  const owner = byOwner.find(o => o.owner === '熊墨樺')!;
  assert.equal(owner.entriesPeriod, 2);
});

test('the last entry is the latest across every account that person holds', () => {
  const { byOwner } = calcLoggingStats(
    [log('g07470', '2026-09-01 10:00'), log('mohua0820', '2026-09-02 09:00')],
    [row()], 3, ASSIGNMENTS, USERS,
  );
  const owner = byOwner.find(o => o.owner === '熊墨樺')!;
  assert.equal(owner.lastEntry, '2026-09-02T01:00:00.000Z');
});

test('somebody else saving does not land in this owner’s count', () => {
  const { byOwner } = calcLoggingStats(
    [log('g07470', '2026-09-01 10:00'), log('g03360', '2026-09-01 11:00')],
    [row()], 3, ASSIGNMENTS, USERS,
  );
  assert.equal(byOwner.find(o => o.owner === '熊墨樺')!.entriesPeriod, 1);
});

test('an account missing from the user directory keeps its username as the name', () => {
  const { timeline } = calcLoggingStats(
    [log('ghost', '2026-09-01 10:00')], [row()], 3, ASSIGNMENTS, USERS,
  );
  assert.deepEqual(timeline, [{ username: 'ghost', week: '2026-09-01', entries: 1 }]);
});

test('the timeline buckets a save on the Taipei day it happened', () => {
  // 07:00 in Taipei is the previous day in UTC; bucketing on that put every
  // early-morning save on the wrong bar.
  const { timeline } = calcLoggingStats(
    [log('g03360', '2026-09-02 07:00')], [row()], 3, ASSIGNMENTS, USERS,
  );
  assert.equal(timeline[0].week, '2026-09-02');
});

test('the instrument is read from the action, then from a _complete in the details', () => {
  const parsed = transformLogs([
    { timestamp: '2026-09-01 10:00', username: 'A', action: 'Update record 1 [ntuh_exam_ct]', details: '', record: '1' },
    { timestamp: '2026-09-01 10:00', username: 'A', action: 'Update record 1', details: "ntuh_nhi_core_complete = '2'", record: '1' },
    { timestamp: '2026-09-01 10:00', username: 'A', action: 'Update record 1', details: 'nothing useful', record: '1' },
  ]);
  assert.deepEqual(parsed.map(p => p.formParsed), ['ntuh_exam_ct', 'ntuh_nhi_core', undefined]);
});
