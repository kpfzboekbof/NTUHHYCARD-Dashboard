import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRedcapTimestamp, taipeiDay } from './timestamp.ts';

test('REDCap stamps its log in Taipei time, not the server timezone', () => {
  // Read as local time on a UTC host this is 08:00 out, which silently moves
  // saves across day and activity-window boundaries.
  assert.equal(parseRedcapTimestamp('2026-09-01 10:30')?.toISOString(), '2026-09-01T02:30:00.000Z');
  assert.equal(parseRedcapTimestamp('2026-09-01 10:30:45')?.toISOString(), '2026-09-01T02:30:45.000Z');
});

test('a timestamp that already carries a zone is left alone', () => {
  assert.equal(parseRedcapTimestamp('2026-09-01T02:30:00.000Z')?.toISOString(), '2026-09-01T02:30:00.000Z');
});

test('nothing usable gives null rather than an Invalid Date that spreads', () => {
  assert.equal(parseRedcapTimestamp('rubbish'), null);
  assert.equal(parseRedcapTimestamp(undefined), null);
  assert.equal(parseRedcapTimestamp(''), null);
});

test('the day of a save is the Taipei day, not the UTC one', () => {
  // 07:00 Taipei is still the previous day in UTC; bucketing on that would put
  // every early-morning save on the wrong bar of the chart.
  assert.equal(taipeiDay(new Date('2026-09-01T23:00:00Z')), '2026-09-02');
  assert.equal(taipeiDay(new Date('2026-09-02T15:59:00Z')), '2026-09-02');
  assert.equal(taipeiDay(new Date('2026-09-02T16:00:00Z')), '2026-09-03');
});
