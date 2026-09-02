import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobHealth, type JobSpec } from './health.ts';
import type { CronRunRow } from '../db/cron-runs.ts';

const SPEC: JobSpec = { job: 'snapshot', label: '狀態快照', everyHours: 24, slackHours: 6, maxRunMinutes: 10 };
const NOW = new Date('2026-09-02T12:00:00Z');

function run(overrides: Partial<CronRunRow> = {}): CronRunRow {
  const startedAt = overrides.startedAt ?? '2026-09-02T11:00:00Z';
  return {
    id: 'r1', job: 'snapshot', startedAt,
    finishedAt: '2026-09-02T11:00:40Z', ok: true, trigger: 'schedule',
    actor: null, actorName: null, result: {}, error: null, tookMs: 40_000,
    ...overrides,
  };
}

test('no run at all is never, not a failure', () => {
  const health = jobHealth({ spec: SPEC, last: null, lastOk: null, now: NOW });
  assert.equal(health.status, 'never');
  assert.equal(health.hoursSinceSuccess, null);
});

test('a run that started and never reported an ending is stuck, not running', () => {
  // This is the case the ledger exists for: the platform killed it at the
  // function time limit, so it could not write its own ending. Without a row
  // opened before the work it is indistinguishable from never having fired.
  const dead = run({ startedAt: '2026-09-02T09:00:00Z', finishedAt: null, ok: null, tookMs: null });
  assert.equal(jobHealth({ spec: SPEC, last: dead, lastOk: null, now: NOW }).status, 'stuck');
});

test('an open row that is still young is a run in progress', () => {
  const live = run({ startedAt: '2026-09-02T11:57:00Z', finishedAt: null, ok: null, tookMs: null });
  assert.equal(jobHealth({ spec: SPEC, last: live, lastOk: null, now: NOW }).status, 'running');
});

test('a finished failure is failing, and keeps the older success visible', () => {
  const failed = run({ ok: false, error: 'REDCap 匯出回傳 0 筆' });
  const succeeded = run({ id: 'r0', startedAt: '2026-09-01T11:00:00Z' });
  const health = jobHealth({ spec: SPEC, last: failed, lastOk: succeeded, now: NOW });
  assert.equal(health.status, 'failing');
  assert.equal(health.hoursSinceSuccess, 25, 'the last time this was true still matters');
});

test('succeeding inside the cadence is ok, and outside it is stale', () => {
  const fresh = run({ startedAt: '2026-09-01T20:00:00Z' });
  assert.equal(jobHealth({ spec: SPEC, last: fresh, lastOk: fresh, now: NOW }).status, 'ok');

  // 24h cadence + 6h slack: 30h is still inside, 31h is not.
  const late = run({ startedAt: '2026-09-01T06:00:00Z' });
  assert.equal(jobHealth({ spec: SPEC, last: late, lastOk: late, now: NOW }).status, 'ok');
  const tooLate = run({ startedAt: '2026-09-01T05:00:00Z' });
  assert.equal(jobHealth({ spec: SPEC, last: tooLate, lastOk: tooLate, now: NOW }).status, 'stale');
});

test('a job that only ever succeeds by hand is flagged however green it looks', () => {
  // The exact shape of a schedule that is not firing: every run is healthy,
  // and the data stops the moment the operator stops pressing the button.
  const manual = run({ trigger: 'manual' });
  const health = jobHealth({
    spec: SPEC, last: manual, lastOk: manual, recent: [manual, run({ id: 'r0', trigger: 'manual' })], now: NOW,
  });
  assert.equal(health.status, 'ok');
  assert.equal(health.scheduleSuspect, true);
});

test('one scheduled success clears the suspicion', () => {
  const health = jobHealth({
    spec: SPEC, last: run({ trigger: 'manual' }), lastOk: run({ trigger: 'manual' }),
    recent: [run({ trigger: 'manual' }), run({ id: 'r0', trigger: 'schedule' })], now: NOW,
  });
  assert.equal(health.scheduleSuspect, false);
});

test('failed manual runs are not evidence either way about the schedule', () => {
  const health = jobHealth({
    spec: SPEC, last: run({ ok: false, trigger: 'manual' }), lastOk: null,
    recent: [run({ ok: false, trigger: 'manual' })], now: NOW,
  });
  assert.equal(health.scheduleSuspect, false, 'nothing has succeeded, so there is nothing to be suspicious of');
});
