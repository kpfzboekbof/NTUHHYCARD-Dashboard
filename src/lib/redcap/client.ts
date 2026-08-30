import { REDCAP_FORM_NAMES, CORE_ASSISTANT_REQUIRED_FIELDS, CORE_ASSISTANT_REQUIRED_FIELDS_NON_ER, CORE_ASSISTANT_CHECKBOX_FIELDS, OUTCOME_ASSISTANT_REQUIRED_FIELDS } from '@/config/forms';
import type { RawCompletionRecord, RawLogEntry, RawUser } from './types';

const REDCAP_URL = process.env.REDCAP_URL || 'https://redcap.ntuh.gov.tw/api/';
const REDCAP_TOKEN = process.env.REDCAP_TOKEN || '';

async function redcapPost(body: Record<string, string>): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('token', REDCAP_TOKEN);
  formData.append('returnFormat', 'json');
  for (const [key, value] of Object.entries(body)) {
    formData.append(key, value);
  }

  const res = await fetch(REDCAP_URL, {
    method: 'POST',
    body: formData,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!res.ok) {
    throw new Error(`REDCap API error: ${res.status} ${res.statusText}`);
  }
  return res;
}

export type RedcapRow = Record<string, string>;

/** Every REDCap value is a string to the rest of the app; nulls become ''. */
function normalizeRow(raw: unknown): RedcapRow {
  const row: RedcapRow = {};
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      row[key] = value === null || value === undefined ? '' : String(value);
    }
  }
  return row;
}

/** Read a REDCap response body, surfacing REDCap's own `{"error": ...}` shape. */
async function redcapJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`REDCap returned malformed JSON: ${text.slice(0, 200)}`);
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
    const detail = String((parsed as { error: unknown }).error);
    throw new Error(`REDCap API error: ${detail.slice(0, 300)}`);
  }
  return parsed;
}

/**
 * Export records as JSON rather than CSV: REDCap's CSV export has to be split
 * on bare commas, so any field value containing one shifts every later column.
 */
async function exportRecords(fields: string[]): Promise<RedcapRow[]> {
  const res = await redcapPost({
    content: 'record',
    format: 'json',
    type: 'flat',
    fields: fields.join(','),
  });
  const parsed = await redcapJson(res);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeRow);
}

/** Aggregate repeat-instrument rows: keep max completion status per study_id per form */
function aggregateRepeatRows(rows: Record<string, string>[]): RawCompletionRecord[] {
  const map = new Map<string, RawCompletionRecord>();
  const completeFields = [
    ...REDCAP_FORM_NAMES.map(f => `${f}_complete`),
    'ntuh_nhi_core_complete',    // needed for Core 醫師 virtual form
    'ntuh_nhi_outcome_complete', // needed for Outcome 醫師 virtual form
  ];

  for (const row of rows) {
    const id = row.study_id;
    let agg = map.get(id);
    if (!agg) {
      agg = { study_id: id, hospital: row.hospital || '0', exclusion: '', sur_icu: '' };
      for (const field of completeFields) {
        agg[field] = '';
      }
      map.set(id, agg);
    }
    // For each _complete field, keep the max value (2 > 1 > 0 > '')
    for (const field of completeFields) {
      const cur = parseInt(agg[field]) || 0;
      const val = parseInt(row[field]) || 0;
      if (val > cur) {
        agg[field] = row[field];
      }
    }
    // hospital and exclusion might be empty in repeat rows; keep non-empty
    if (row.hospital && row.hospital !== '') {
      agg.hospital = row.hospital;
    }
    if (row.exclusion !== undefined && row.exclusion !== '') {
      agg.exclusion = row.exclusion;
    }
    if (row.sur_icu !== undefined && row.sur_icu !== '') {
      agg.sur_icu = row.sur_icu;
    }
  }

  return Array.from(map.values());
}

export async function fetchCompletionStatus(): Promise<RawCompletionRecord[]> {
  // Include ntuh_nhi_core_complete for Core 醫師 virtual form
  const fields = ['study_id', 'hospital', 'exclusion', 'sur_icu', 'ntuh_nhi_core_complete', 'ntuh_nhi_outcome_complete', ...REDCAP_FORM_NAMES.map(f => `${f}_complete`)];

  return aggregateRepeatRows(await exportRecords(fields));
}

export async function fetchUsers(): Promise<RawUser[]> {
  const res = await redcapPost({
    content: 'user',
    format: 'json',
  });
  return res.json();
}

/** Fetch Core assistant required fields and compute per-record completion */
export async function fetchCoreAssistantStatus(): Promise<Map<string, boolean>> {
  // Include er_arrival to determine which field set to check, plus all possible required fields
  const allFields = new Set([
    'study_id', 'er_arrival',
    ...CORE_ASSISTANT_REQUIRED_FIELDS,
    ...CORE_ASSISTANT_REQUIRED_FIELDS_NON_ER,
  ]);
  const rows = await exportRecords(Array.from(allFields));

  // Only process main rows (no repeat instrument)
  const result = new Map<string, boolean>();
  for (const row of rows) {
    if (row.redcap_repeat_instrument) continue;
    const id = row.study_id;
    if (!id) continue;

    // Determine which fields to check based on er_arrival
    const isErArrival = row.er_arrival === '0';
    const requiredFields = isErArrival
      ? CORE_ASSISTANT_REQUIRED_FIELDS   // er_arrival=0: full field set
      : CORE_ASSISTANT_REQUIRED_FIELDS_NON_ER; // er_arrival!=0: only tohospital_core + prehos_rosc_core

    let allFilled = true;
    for (const field of requiredFields) {
      if (CORE_ASSISTANT_CHECKBOX_FIELDS.includes(field)) {
        const checkboxCols = Object.keys(row).filter(k => k.startsWith(`${field}___`));
        const anyChecked = checkboxCols.some(k => row[k] === '1');
        if (!anyChecked) { allFilled = false; break; }
      } else {
        if (!row[field] || row[field] === '') { allFilled = false; break; }
      }
    }
    result.set(id, allFilled);
  }
  return result;
}

/** Fetch Outcome assistant + etiology_final fields, compute per-record status */
export async function fetchOutcomeStatus(): Promise<{
  assistantStatus: Map<string, boolean>;
  etiologyFinalStatus: Map<string, boolean>;
}> {
  const fields = ['study_id', 'etiology_final', ...OUTCOME_ASSISTANT_REQUIRED_FIELDS];
  const rows = await exportRecords(fields);

  const assistantStatus = new Map<string, boolean>();
  const etiologyFinalStatus = new Map<string, boolean>();

  for (const row of rows) {
    if (row.redcap_repeat_instrument) continue;
    const id = row.study_id;
    if (!id) continue;

    // Outcome assistant: all required fields filled
    let allFilled = true;
    for (const field of OUTCOME_ASSISTANT_REQUIRED_FIELDS) {
      if (!row[field] || row[field] === '') { allFilled = false; break; }
    }
    assistantStatus.set(id, allFilled);

    // Outcome etiology_final: not empty
    etiologyFinalStatus.set(id, row.etiology_final !== undefined && row.etiology_final !== '');
  }

  return { assistantStatus, etiologyFinalStatus };
}

/** Fetch study IDs where any reviewer marked cause_all_etiology_new = 1 (trauma) */
export async function fetchTraumaEligibleIds(): Promise<Set<string>> {
  const rows = await exportRecords(['study_id', 'cause_all_etiology_new']);
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.cause_all_etiology_new === '1' && row.study_id) {
      ids.add(row.study_id);
    }
  }
  return ids;
}

export async function fetchEtiologyStatus(): Promise<RedcapRow[]> {
  return exportRecords([
    'study_id', 'reg_no', 'exclusion', 'labeler', 'etiology_final',
    'ntuh_nhi_etiology_complete',
    'cause_all_etiology_new', 'cause_med_etiology_new',
    'cause_tra_etiology_new', 'cause_asphy_etiology_new',
  ]);
}

export interface ImportResult {
  /** Study IDs we asked REDCap to write. */
  requested: string[];
  /** Study IDs REDCap confirmed it wrote. */
  imported: string[];
  /** Requested but unconfirmed — these were NOT written and must stay in the queue. */
  missing: string[];
}

/**
 * Import field values into REDCap and verify the write per record.
 *
 * `returnContent: 'ids'` makes REDCap answer with the record IDs it actually
 * wrote, so a partial import is visible instead of hiding behind a total count.
 */
async function importRecords(
  records: Array<{ study_id: string; [field: string]: string }>,
): Promise<ImportResult> {
  const requested = records.map(r => r.study_id);
  if (records.length === 0) return { requested: [], imported: [], missing: [] };

  const res = await redcapPost({
    content: 'record',
    action: 'import',
    format: 'json',
    type: 'flat',
    overwriteBehavior: 'overwrite',
    returnContent: 'ids',
    data: JSON.stringify(records),
  });

  const parsed = await redcapJson(res);
  const imported = Array.isArray(parsed) ? parsed.map(id => String(id)) : [];
  const confirmed = new Set(imported);
  return { requested, imported, missing: requested.filter(id => !confirmed.has(id)) };
}

export async function importEtiologyFinal(studyId: string, code: number): Promise<void> {
  const { missing } = await importRecords([
    { study_id: studyId, etiology_final: code.toString() },
  ]);
  if (missing.length > 0) {
    throw new Error(`REDCap 未確認 study ${studyId} 的寫入，請重新整理後確認`);
  }
}

/** Batch import field values into REDCap, reporting which records were written. */
export async function batchImportField(
  records: Array<{ study_id: string; [field: string]: string }>,
): Promise<ImportResult> {
  return importRecords(records);
}

/** Fetch fields needed for QC record-level checks */
export async function fetchQcRecords(): Promise<RedcapRow[]> {
  // Note: redcap_repeat_instrument is returned automatically for repeating projects
  const fields = [
    'study_id', 'hospital', 'exclusion',
    // A1-A2: 重複欄位衝突 (DNR)
    'initial_dnr_core', 'ini_dnr', 'mid_dnr_core', 'mid_dnr',
    // A3: any_rosc vs ever_rosc + prehos_rosc_core
    'any_rosc', 'ever_rosc', 'prehos_rosc_core',
    // A4: edoutcome_core vs sur_icu
    'edoutcome_core', 'sur_icu',
    // B2: ini_dnr + defibrillation (ini_dnr already above)
    'defibrillation',
    // B3: sur_icu vs sur_dis (sur_icu already above)
    'sur_dis',
    // B4-B5: edoutcome_core vs cpc, sur_dis vs cpc (edoutcome_core, sur_dis already above)
    'cpc',
    // C1, C2, C3
    'icu_ad_time', 'hosp_dis_time', 'wlst_time',
    // E1
    'duration',
    // E3
    'emt_core', 'emtp_core', 'witnessed_core',
    'bystander_core', 'pad_core', 'manual_core', 'mcc_core', 'aed_core',
  ];
  return exportRecords(fields);
}

export async function fetchLogging(monthsBack: number = 3): Promise<RawLogEntry[]> {
  const beginDate = new Date();
  beginDate.setMonth(beginDate.getMonth() - monthsBack);
  const beginTime = beginDate.toISOString().slice(0, 16).replace('T', ' ');

  const res = await redcapPost({
    content: 'log',
    format: 'json',
    logtype: 'record',
    beginTime,
  });

  const text = await res.text();
  if (!text || text === '[]' || text.length < 10) {
    return [];
  }
  return JSON.parse(text);
}
