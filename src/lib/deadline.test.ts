import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, deadlinePhrase, isTaipeiWeekend, taipeiWeekday } from './deadline.ts';

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

test('the weekend is decided in Taipei, not on the server clock', () => {
  // 2026-09-05 is a Saturday. At 16:00 Taipei it is 08:00 UTC — still Saturday
  // either way — but at 07:00 Taipei on Monday 09-07 it is 23:00 UTC Sunday,
  // and a UTC host would call that the weekend.
  assert.equal(isTaipeiWeekend(new Date('2026-09-05T08:00:00Z')), true);
  assert.equal(isTaipeiWeekend(new Date('2026-09-06T08:00:00Z')), true);
  assert.equal(isTaipeiWeekend(new Date('2026-09-06T23:00:00Z')), false, 'Monday 07:00 Taipei');
  assert.equal(isTaipeiWeekend(new Date('2026-09-04T08:00:00Z')), false, 'Friday');
});

test('taipeiWeekday follows the same clock', () => {
  assert.equal(taipeiWeekday(new Date('2026-09-05T08:00:00Z')), 6);
  assert.equal(taipeiWeekday(new Date('2026-09-06T23:00:00Z')), 1);
});
