import { FORM_NAMES } from '@/config/forms';
import { HOSPITALS } from '@/config/hospitals';
import type { CompletionRow, CompletionStatus, PackedCompletion, PackedForm, PackedRecord } from '@/types';

/**
 * Packing the completion matrix for the wire and the cache.
 *
 * `transformCompletion` emits one `CompletionRow` per (record × applicable
 * form): ~7,200 records × ~27 forms, each row repeating the study id, the
 * hospital name, the form name, its label, its owner and the status text. That
 * is on the order of 30 MB of JSON — stringified on every request, stored as
 * one cache value, parsed by the browser on every dashboard load.
 *
 * Everything that varies per row is the status code; everything else is a
 * property of the record or of the form. So: one entry per form, one tuple
 * per record with a string of status characters, and `unpackCompletion` puts
 * the rows back exactly as they were — same order, same fields — so no
 * component has to know the difference.
 */

const NOT_APPLICABLE = '-';

/** Where a form sits in the canonical FORMS order; unknown forms go last. */
function formRank(form: string): number {
  const index = FORM_NAMES.indexOf(form);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function hospitalName(hospital: number): string {
  return HOSPITALS[hospital] || `院區${hospital}`;
}

function statusText(code: CompletionStatus): CompletionRow['status'] {
  return code === 2 ? 'Complete' : code === 1 ? 'Unverified' : 'Incomplete';
}

export function packCompletion(rows: CompletionRow[]): PackedCompletion {
  // Forms in FORMS order regardless of which record happened to come first:
  // the rows were produced by walking FORMS per record, and unpacking walks
  // the packed forms per record, so the same order gives back the same rows.
  const formsByName = new Map<string, PackedForm>();
  for (const row of rows) {
    if (!formsByName.has(row.form)) {
      formsByName.set(row.form, { form: row.form, label: row.label, owner: row.owner });
    }
  }
  const forms = [...formsByName.values()].sort((a, b) => formRank(a.form) - formRank(b.form));
  const formIndex = new Map(forms.map((f, i) => [f.form, i]));

  const recordIndex = new Map<string, number>();
  const records: Array<{ studyId: string; hospital: number; excluded: boolean; statuses: string[] }> = [];

  for (const row of rows) {
    let index = recordIndex.get(row.studyId);
    if (index === undefined) {
      index = records.length;
      recordIndex.set(row.studyId, index);
      records.push({
        studyId: row.studyId,
        hospital: row.hospital,
        excluded: row.excluded,
        statuses: new Array<string>(forms.length).fill(NOT_APPLICABLE),
      });
    }
    records[index].statuses[formIndex.get(row.form)!] = String(row.statusCode);
  }

  return {
    forms,
    records: records.map<PackedRecord>(r => [r.studyId, r.hospital, r.excluded ? 1 : 0, r.statuses.join('')]),
  };
}

export function unpackCompletion(packed: PackedCompletion): CompletionRow[] {
  const rows: CompletionRow[] = [];
  const { forms } = packed;

  for (const [studyId, hospital, excludedFlag, statuses] of packed.records) {
    const name = hospitalName(hospital);
    const excluded = excludedFlag === 1;

    for (let i = 0; i < forms.length; i++) {
      const char = statuses[i];
      if (char === undefined || char === NOT_APPLICABLE) continue;
      const statusCode: CompletionStatus = char === '2' ? 2 : char === '1' ? 1 : 0;
      const form = forms[i];
      rows.push({
        studyId,
        hospital,
        hospitalName: name,
        form: form.form,
        label: form.label,
        owner: form.owner,
        statusCode,
        status: statusText(statusCode),
        excluded,
      });
    }
  }

  return rows;
}
