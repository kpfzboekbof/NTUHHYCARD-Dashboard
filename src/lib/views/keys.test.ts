import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPENDENTS, LOG_MONTHS, VIEW, WRITE_EFFECTS, allViewKeys, withDependents } from './keys.ts';

test('withDependents follows the chain and deduplicates', () => {
  const keys = withDependents([VIEW.matrix]);
  assert.ok(keys.includes(VIEW.matrix));
  assert.ok(keys.includes(VIEW.ownersProgress));
  assert.equal(new Set(keys).size, keys.length);
});

test('every dependent named is a real view', () => {
  const all = new Set(allViewKeys());
  for (const [source, dependents] of Object.entries(DEPENDENTS)) {
    assert.ok(all.has(source), `${source} is not a view`);
    for (const dependent of dependents) assert.ok(all.has(dependent), `${dependent} is not a view`);
  }
});

test('a settings change reaches every REDCap-derived view and what is built on them', () => {
  // Owners, hidden forms, targets and labelers are baked into these builds;
  // a view this set misses would show the previous settings until its
  // freshness window ran out.
  const touched = new Set(WRITE_EFFECTS.settings);
  for (const key of [VIEW.completion, VIEW.matrix, VIEW.etiology, VIEW.qc, VIEW.ownersProgress, ...LOG_MONTHS.map(VIEW.logging)]) {
    assert.ok(touched.has(key), `settings change does not invalidate ${key}`);
  }
});

test('an etiology_final write reaches the views that read consensus', () => {
  const touched = new Set(WRITE_EFFECTS.etiologyFinal);
  for (const key of [VIEW.etiology, VIEW.matrix, VIEW.completion, VIEW.ownersProgress]) {
    assert.ok(touched.has(key), `etiology_final write does not invalidate ${key}`);
  }
  // The raw log is REDCap's own record; a write does not make it wrong.
  assert.ok(!touched.has(VIEW.redcapLogs(3)));
});
