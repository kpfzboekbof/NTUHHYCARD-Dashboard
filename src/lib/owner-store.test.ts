import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, DEFAULT_HIDDEN_FORMS } from './owner-store.ts';

/**
 * The rule that matters: a form nobody is entering yet is hidden by default,
 * but a manager's saved list always wins — otherwise unhiding it when entry
 * begins would need a deploy.
 */

test('the forms nobody is entering yet are the default hidden list', () => {
  assert.deepEqual([...DEFAULT_HIDDEN_FORMS].sort(), ['ntuh_exam_ct', 'ntuh_nhi_ed_vital']);
});

test('an unconfigured store starts with them hidden', () => {
  for (const nothing of [null, undefined, '', 0]) {
    assert.deepEqual(normalize(nothing).hiddenForms, DEFAULT_HIDDEN_FORMS);
  }
  assert.deepEqual(normalize({ assignments: {} }).hiddenForms, DEFAULT_HIDDEN_FORMS);
});

test("a manager's saved list wins, including an empty one", () => {
  // This is how a form comes back once entry starts: untick and save.
  assert.deepEqual(normalize({ hiddenForms: [] }).hiddenForms, []);
  assert.deepEqual(normalize({ hiddenForms: ['ntuh_exam_pes'] }).hiddenForms, ['ntuh_exam_pes']);
});

test('the default is copied, not shared, so one store cannot mutate the next', () => {
  const first = normalize(null);
  first.hiddenForms.push('mutated');
  assert.deepEqual(normalize(null).hiddenForms, DEFAULT_HIDDEN_FORMS);
});

test('the pre-split targetId shape still loads', () => {
  assert.deepEqual(normalize({ targetId: 5000 }).targetIds, { basic: 5000, exam: 5000 });
});
