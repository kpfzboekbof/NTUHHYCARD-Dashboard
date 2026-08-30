import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, findUnknownFields } from './validate.ts';
import { buildSeedCatalog } from './seed.ts';
import type { CatalogDoc, WorkUnit } from './types.ts';

function seed(): CatalogDoc {
  return structuredClone(buildSeedCatalog());
}

function unit(id: string, overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    unitId: id,
    label: id,
    redcapForm: 'form_a',
    deepLinkPage: 'form_a',
    kind: 'full_form',
    completionRule: { type: 'complete_field', completeField: 'form_a_complete' },
    applicability: { expr: 'true', gatingFields: [] },
    dependencies: [],
    category: 'basic',
    defaultTarget: 6000,
    sortOrder: 0,
    ...overrides,
  };
}

function docOf(units: WorkUnit[]): CatalogDoc {
  return { units, settings: seed().settings };
}

test('the shipped seed is valid', () => {
  assert.deepEqual(validateCatalog(buildSeedCatalog()), []);
});

test('duplicate unit ids are rejected', () => {
  const issues = validateCatalog(docOf([unit('a'), unit('a')]));
  assert.ok(issues.some(i => i.message.includes('重複')));
});

test('dependencies must point at real units', () => {
  const issues = validateCatalog(docOf([
    unit('a', { dependencies: [{ unitId: 'ghost', type: 'verify_after' }] }),
  ]));
  assert.ok(issues.some(i => i.message.includes('ghost')));
});

test('a unit cannot depend on itself', () => {
  const issues = validateCatalog(docOf([
    unit('a', { dependencies: [{ unitId: 'a', type: 'verify_after' }] }),
  ]));
  assert.ok(issues.some(i => i.message.includes('自己')));
});

test('blocking dependency cycles are caught', () => {
  // Left undetected these units would sit blocked forever with no visible cause.
  const issues = validateCatalog(docOf([
    unit('a', { dependencies: [{ unitId: 'b', type: 'verify_after' }] }),
    unit('b', { dependencies: [{ unitId: 'c', type: 'data_gate' }] }),
    unit('c', { dependencies: [{ unitId: 'a', type: 'verify_after' }] }),
  ]));
  const cycle = issues.find(i => i.message.includes('循環'));
  assert.ok(cycle, 'cycle not reported');
  assert.match(cycle.message, /a.*b.*c/);
});

test('soft_order cycles are allowed because they never block', () => {
  const issues = validateCatalog(docOf([
    unit('a', { dependencies: [{ unitId: 'b', type: 'soft_order' }] }),
    unit('b', { dependencies: [{ unitId: 'a', type: 'soft_order' }] }),
  ]));
  assert.deepEqual(issues, []);
});

test('unparseable applicability expressions are rejected', () => {
  const issues = validateCatalog(docOf([
    unit('a', { applicability: { expr: "sur_icu ==", gatingFields: [] } }),
  ]));
  assert.ok(issues.some(i => i.message.includes('適用條件無法解析')));
});

test('completion rule must match the unit kind', () => {
  const issues = validateCatalog(docOf([
    unit('a', { kind: 'verify', completionRule: { type: 'complete_field', completeField: 'x' } }),
  ]));
  assert.ok(issues.some(i => i.message.includes('不相符')));
});

test('required_fields needs a trailing else variant', () => {
  const noElse = validateCatalog(docOf([
    unit('a', {
      kind: 'field_group',
      completionRule: { type: 'required_fields', variants: [{ when: "x == '1'", fields: ['y'] }] },
    }),
  ]));
  assert.ok(noElse.some(i => i.message.includes('else')));

  const elseFirst = validateCatalog(docOf([
    unit('a', {
      kind: 'field_group',
      completionRule: {
        type: 'required_fields',
        variants: [{ when: 'else', fields: ['y'] }, { when: "x == '1'", fields: ['z'] }],
      },
    }),
  ]));
  assert.ok(elseFirst.some(i => i.message.includes('最後')));
});

test('a consensus rule that rewards dissent is rejected', () => {
  const issues = validateCatalog(docOf([
    unit('a', {
      kind: 'adjudication',
      completionRule: {
        type: 'adjudication',
        consensusRule: { minVotes: 3, allowSingleDissenter: true, dissenterMajorityMin: 2 },
      },
    }),
  ]));
  assert.ok(issues.some(i => i.message.includes('dissenterMajorityMin')));
});

test('grade thresholds must decrease', () => {
  const doc = seed();
  doc.settings.gradeThresholds = [60, 90, 30];
  assert.ok(validateCatalog(doc).some(i => i.message.includes('遞減')));
});

test('fields missing from REDCap are reported against their unit', () => {
  const catalog = buildSeedCatalog();
  const known = new Set(['sur_icu', 'ntuh_nhi_lab_icu_complete']);
  const issues = findUnknownFields(catalog, known);

  assert.ok(issues.length > 0);
  assert.ok(issues.every(i => i.unitId));
  // Fields that do exist are not reported.
  assert.ok(!issues.some(i => i.message.includes('sur_icu')));
});
