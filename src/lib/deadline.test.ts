import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, deadlinePhrase } from './deadline.ts';

const NOW = new Date('2026-09-10T02:00:00Z'); // 2026-09-10 10:00 Taipei

test('the countdown is in whole Taipei days', () => {
  assert.equal(daysUntil('2026-09-30', NOW), 20);
  assert.equal(daysUntil('2026-09-10', NOW), 0);
  assert.equal(daysUntil('2026-09-08', NOW), -2);
});

test('a late-evening Taipei time is still the same Taipei day', () => {
  // 2026-09-10 23:30 Taipei is 15:30 UTC; naive UTC maths would say 20 days.
  assert.equal(daysUntil('2026-09-11', new Date('2026-09-10T15:30:00Z')), 1);
});

test('the deadline reads as a human deadline', () => {
  assert.equal(deadlinePhrase('2026-09-30', NOW), '還有 20 天');
  assert.equal(deadlinePhrase('2026-09-10', NOW), '今天到期');
  assert.equal(deadlinePhrase('2026-09-01', NOW), '已逾期 9 天');
  assert.equal(deadlinePhrase(null, NOW), '');
});
