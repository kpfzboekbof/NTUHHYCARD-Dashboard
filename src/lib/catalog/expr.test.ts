import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpr, parseExpr, ExprError, type ExprContext, type Tri } from './expr.ts';

function ctx(fields: Record<string, string | string[]>, extra: Partial<ExprContext> = {}): ExprContext {
  return {
    fieldValues: (name) => {
      const value = fields[name];
      if (value === undefined) return [];
      return Array.isArray(value) ? value : [value];
    },
    studyIdNum: 5123,
    batchCutoff: () => null,
    ...extra,
  };
}

function check(expr: string, context: ExprContext, expected: Tri) {
  assert.equal(evaluateExpr(expr, context), expected, `${expr} should be ${expected}`);
}

test('literal true is always applicable', () => {
  check('true', ctx({}), 'true');
  check('false', ctx({}), 'false');
});

test('equality against a filled field', () => {
  check("sur_icu == '1'", ctx({ sur_icu: '1' }), 'true');
  check("sur_icu == '1'", ctx({ sur_icu: '0' }), 'false');
});

test('an unfilled field is unknown, not false', () => {
  // This is the distinction the old boolean logic could not make: the patient
  // is not "not applicable", nobody has entered sur_icu yet.
  check("sur_icu == '1'", ctx({ sur_icu: '' }), 'unknown');
  check("sur_icu == '1'", ctx({}), 'unknown');
});

test('inequality is the negation of equality', () => {
  check("sur_icu != '1'", ctx({ sur_icu: '0' }), 'true');
  check("sur_icu != '1'", ctx({ sur_icu: '1' }), 'false');
  check("sur_icu != '1'", ctx({ sur_icu: '' }), 'unknown');
});

test('repeat-row fields match existentially', () => {
  // cause_all_etiology_new lives on the etiology vote rows: the trauma form
  // applies when ANY labeler classified the case as trauma.
  const votes = ctx({ cause_all_etiology_new: ['0', '1', '0'] });
  check("cause_all_etiology_new == '1'", votes, 'true');

  const noTrauma = ctx({ cause_all_etiology_new: ['0', '0'] });
  check("cause_all_etiology_new == '1'", noTrauma, 'false');

  const noVotesYet = ctx({ cause_all_etiology_new: [] });
  check("cause_all_etiology_new == '1'", noVotesYet, 'unknown');
});

test('conjunction short-circuits on false but propagates unknown', () => {
  check("sur_icu == '1' && sur_dis == '1'", ctx({ sur_icu: '0', sur_dis: '' }), 'false');
  check("sur_icu == '1' && sur_dis == '1'", ctx({ sur_icu: '1', sur_dis: '' }), 'unknown');
  check("sur_icu == '1' && sur_dis == '1'", ctx({ sur_icu: '1', sur_dis: '1' }), 'true');
});

test('disjunction short-circuits on true but propagates unknown', () => {
  check("sur_icu == '1' || sur_dis == '1'", ctx({ sur_icu: '1', sur_dis: '' }), 'true');
  check("sur_icu == '1' || sur_dis == '1'", ctx({ sur_icu: '0', sur_dis: '' }), 'unknown');
  check("sur_icu == '1' || sur_dis == '1'", ctx({ sur_icu: '0', sur_dis: '0' }), 'false');
});

test('parentheses group as written', () => {
  const context = ctx({ a: '1', b: '0', c: '1' });
  check("a == '1' && (b == '1' || c == '1')", context, 'true');
  check("(a == '1' && b == '1') || c == '1'", context, 'true');
  check("a == '1' && (b == '1' || c == '0')", context, 'false');
});

test('in matches any listed value', () => {
  check("cpc in ('1','2')", ctx({ cpc: '2' }), 'true');
  check("cpc in ('1','2')", ctx({ cpc: '3' }), 'false');
  check("cpc in ('1','2')", ctx({ cpc: '' }), 'unknown');
});

test('numeric comparison over studyIdNum', () => {
  const withBatch = ctx({}, { batchCutoff: (slug) => (slug === 'mtdna' ? 6000 : null) });
  check("studyIdNum <= batch('mtdna').cutoff", withBatch, 'true');
  check("studyIdNum > batch('mtdna').cutoff", withBatch, 'false');
});

test('a missing batch is unknown so the work blocks visibly', () => {
  // Rather than silently marking every patient not-applicable.
  check("studyIdNum <= batch('nonexistent').cutoff", ctx({}), 'unknown');
});

test('a bare field is truthy when non-empty and non-zero', () => {
  check('exclusion', ctx({ exclusion: '1' }), 'true');
  check('exclusion', ctx({ exclusion: '0' }), 'false');
  check('exclusion', ctx({ exclusion: '' }), 'unknown');
});

test('malformed expressions are rejected at parse time', () => {
  assert.throws(() => parseExpr("sur_icu == "), ExprError);
  assert.throws(() => parseExpr("sur_icu == '1' &&"), ExprError);
  assert.throws(() => parseExpr("sur_icu == '1"), ExprError);
  assert.throws(() => parseExpr("batch('x').missing"), ExprError);
  assert.throws(() => parseExpr("sur_icu == '1' extra"), ExprError);
});
