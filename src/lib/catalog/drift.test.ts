import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDrift, knownFieldNames } from './drift.ts';
import { buildSeedCatalog } from './seed.ts';
import type { RedcapRow } from '@/lib/redcap/client';

function dictionary(entries: Array<[string, string]>): RedcapRow[] {
  return entries.map(([form_name, field_name]) => ({ form_name, field_name }));
}

test('_complete fields count as known even though REDCap omits them', () => {
  const known = knownFieldNames(dictionary([['form_a', 'x']]));
  assert.ok(known.has('x'));
  assert.ok(known.has('form_a_complete'));
});

test('an instrument the catalog reads but REDCap lacks is reported', () => {
  // The live case: the catalog carried ntuh_exam_holtertreadmill, whose
  // _complete field read empty for all 7169 records because REDCap has no
  // such instrument — the Holter answers are fields inside examcheck.
  const catalog = buildSeedCatalog();
  const metadata = dictionary(
    [...new Set(catalog.units.map(u => u.redcapForm))]
      .filter(form => form !== 'ntuh_exam_holtertreadmill')
      .map(form => [form, `${form}_field`] as [string, string]),
  );

  const drift = detectDrift(catalog, metadata);
  assert.deepEqual(drift.missingForms, ['ntuh_exam_holtertreadmill']);
  assert.equal(drift.clean, false);
});

test('an instrument REDCap has but nothing tracks is reported', () => {
  const catalog = buildSeedCatalog();
  const metadata = dictionary([
    ...[...new Set(catalog.units.map(u => u.redcapForm))].map(f => [f, `${f}_field`] as [string, string]),
    ['ntuh_exam_ct', 'date_ct'],
  ]);

  const drift = detectDrift(catalog, metadata);
  assert.deepEqual(drift.missingForms, []);
  assert.ok(drift.untrackedForms.includes('ntuh_exam_ct'));
});

test('a dictionary covering the catalog reports clean', () => {
  const catalog = buildSeedCatalog();
  const fields = new Set<string>();
  for (const unit of catalog.units) {
    const rule = unit.completionRule;
    if (rule.type === 'complete_field' || rule.type === 'verify') fields.add(rule.completeField);
    if (rule.type === 'derived_field') fields.add(rule.watchField);
    if (rule.type === 'required_fields') for (const v of rule.variants) for (const f of v.fields) fields.add(f);
    for (const g of unit.applicability.gatingFields) fields.add(g.field);
  }
  const forms = [...new Set(catalog.units.map(u => u.redcapForm))];
  const metadata: RedcapRow[] = [
    ...forms.map(form => ({ form_name: form, field_name: `${form}__filler` })),
    // _complete fields are derived from form_name, so drop them here.
    ...[...fields].filter(f => !f.endsWith('_complete')).map(f => ({ form_name: forms[0], field_name: f })),
  ];

  assert.deepEqual(detectDrift(catalog, metadata).clean, true);
});
