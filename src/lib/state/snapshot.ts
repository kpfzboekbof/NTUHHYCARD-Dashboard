import { collectFields, parseExpr } from '@/lib/catalog/expr';
import type { CatalogDoc } from '@/lib/catalog/types';
import type { RedcapRow } from '@/lib/redcap/client';
import type { RecordSnapshot } from './types';

/**
 * Turning a REDCap export into the input the state engine reads.
 *
 * The field list is computed from the catalog rather than hardcoded, so adding
 * a work unit that watches a new field automatically widens the export instead
 * of silently evaluating that field as empty.
 */

/** Fields always needed regardless of what the catalog references. */
const BASE_FIELDS = ['study_id', 'hospital', 'exclusion'];

export function catalogFieldSet(catalog: CatalogDoc): string[] {
  const fields = new Set<string>(BASE_FIELDS);

  for (const unit of catalog.units) {
    for (const name of collectFields(parseExpr(unit.applicability.expr))) fields.add(name);
    for (const gate of unit.applicability.gatingFields) fields.add(gate.field);

    const rule = unit.completionRule;
    switch (rule.type) {
      case 'complete_field':
      case 'verify':
        fields.add(rule.completeField);
        break;
      case 'derived_field':
        fields.add(rule.watchField);
        break;
      case 'required_fields':
        for (const variant of rule.variants) {
          for (const field of variant.fields) fields.add(field);
          // Variant conditions read fields too (er_arrival decides which set
          // of prehospital fields the assistant owes).
          if (variant.when !== 'else') {
            for (const name of collectFields(parseExpr(variant.when))) fields.add(name);
          }
        }
        break;
      case 'adjudication':
        // Votes come from the etiology transform, not from this export.
        break;
    }
  }

  return [...fields].sort();
}

/**
 * Group flat REDCap rows into one snapshot per record.
 *
 * REDCap returns repeating-instrument rows alongside the main row; values from
 * repeats are kept separately so a field like the etiology vote can be read
 * across every reviewer.
 */
export function buildSnapshots(rows: RedcapRow[]): RecordSnapshot[] {
  const byId = new Map<string, RecordSnapshot>();

  for (const row of rows) {
    const studyId = row.study_id;
    if (!studyId) continue;

    let snapshot = byId.get(studyId);
    if (!snapshot) {
      snapshot = { studyId, main: {}, repeats: {} };
      byId.set(studyId, snapshot);
    }

    const isRepeat = (row.redcap_repeat_instrument ?? '') !== '';
    for (const [field, value] of Object.entries(row)) {
      if (field.startsWith('redcap_')) continue;
      if (value === '') continue;

      if (isRepeat) {
        (snapshot.repeats[field] ??= []).push(value);
      } else {
        snapshot.main[field] = value;
      }
    }
  }

  return [...byId.values()];
}
