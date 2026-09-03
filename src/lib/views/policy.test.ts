import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFreshness, invalidationSurvivesBuild, leaseActive } from './policy.ts';

const T0 = Date.parse('2026-09-03T00:00:00Z');
const minutes = (n: number) => n * 60_000;
const at = (ms: number) => new Date(ms).toISOString();

test('within the window is fresh', () => {
  assert.equal(assessFreshness({ fetchedAt: at(T0), invalidatedAt: null, freshSeconds: 600, now: T0 + minutes(5) }), 'fresh');
});

test('past the window is stale', () => {
  assert.equal(assessFreshness({ fetchedAt: at(T0), invalidatedAt: null, freshSeconds: 600, now: T0 + minutes(11) }), 'stale');
});

test('any unabsorbed invalidation wins over freshness, whatever its timestamp', () => {
  // A write during a build: the build finished after the write, so the two
  // timestamps alone would call the snapshot current. It is not.
  assert.equal(assessFreshness({
    fetchedAt: at(T0 + 8000),
    invalidatedAt: at(T0 + 2000),
    freshSeconds: 600,
    now: T0 + 9000,
  }), 'invalidated');
});

test('an unparseable timestamp is treated as stale, never fresh', () => {
  assert.equal(assessFreshness({ fetchedAt: 'garbage', invalidatedAt: null, freshSeconds: 600, now: T0 }), 'stale');
});

test('a lease expires', () => {
  const started = at(T0);
  assert.equal(leaseActive(started, 180, T0 + 60_000), true);
  assert.equal(leaseActive(started, 180, T0 + 181_000), false);
  assert.equal(leaseActive(null, 180, T0), false);
  assert.equal(leaseActive('garbage', 180, T0), false);
});

test('a write during the build keeps the invalidation; one before it is absorbed', () => {
  const buildStart = at(T0);
  assert.equal(invalidationSurvivesBuild(at(T0 + 2000), buildStart), at(T0 + 2000));
  assert.equal(invalidationSurvivesBuild(at(T0 - 2000), buildStart), null);
  assert.equal(invalidationSurvivesBuild(null, buildStart), null);
});
