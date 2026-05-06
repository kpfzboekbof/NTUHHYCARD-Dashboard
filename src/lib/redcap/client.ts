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

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(',').map(v => v.replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
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

  const res = await redcapPost({
    content: 'record',
    format: 'csv',
    fields: fields.join(','),
  });

  const text = await res.text();
  const rawRows = parseCsv(text);
  return aggregateRepeatRows(rawRows);
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
  const res = await redcapPost({
    content: 'record',
    format: 'csv',
    fields: Array.from(allFields).join(','),
  });
  const text = await res.text();
  const rows = parseCsv(text);

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
  const res = await redcapPost({
    content: 'record',
    format: 'csv',
    fields: fields.join(','),
  });
  const text = await res.text();
  const rows = parseCsv(text);

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
  const res = await redcapPost({
    content: 'record',
    format: 'csv',
    fields: 'study_id,cause_all_etiology_new',
  });
  const text = await res.text();
  const rows = parseCsv(text);
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.cause_all_etiology_new === '1' && row.study_id) {
      ids.add(row.study_id);
    }
  }
  return ids;
}

export async function fetchEtiologyStatus(): Promise<Record<string, string>[]> {
  const res = await redcapPost({
    content: 'record',
    format: 'csv',
    fields: 'study_id,reg_no,exclusion,labeler,etiology_final,ntuh_nhi_etiology_complete,cause_all_etiology_new,cause_med_etiology_new,cause_tra_etiology_new,cause_asphy_etiology_new',
  });
  const text = await res.text();
  return parseCsv(text);
}

export async function importEtiologyFinal(studyId: string, code: number): Promise<void> {
  const data = JSON.stringify([{ study_id: studyId, etiology_final: code.toString() }]);
  const res = await redcapPost({
    content: 'record',
    action: 'import',
    format: 'json',
    type: 'flat',
    overwriteBehavior: 'overwrite',
    data,
  });
  const text = await res.text();
  // REDCap may return "1", "count:1", or {"count":1} depending on version
  const match = text.match(/(\d+)/);
  const count = match ? parseInt(match[1]) : 0;
  if (count < 1) {
    throw new Error(`REDCap import returned unexpected response: ${text}`);
  }
}

/** Batch import field values into REDCap. Returns the number of records updated. */
export async function batchImportField(
  records: Array<{ study_id: string; [field: string]: string }>,
): Promise<number> {
  if (records.length === 0) return 0;
  const data = JSON.stringify(records);
  const res = await redcapPost({
    content: 'record',
    action: 'import',
    format: 'json',
    type: 'flat',
    overwriteBehavior: 'overwrite',
    data,
  });
  const text = await res.text();
  const match = text.match(/(\d+)/);
  const count = match ? parseInt(match[1]) : 0;
  if (count < 1) {
    throw new Error(`REDCap batch import returned unexpected response: ${text}`);
  }
  return count;
}

/** Fetch fields needed for QC record-level checks */
export async function fetchQcRecords(): Promise<Record<string, string>[]> {
  // Note: redcap_repeat_instrument is included automatically in CSV output
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
  const res = await redcapPost({
    content: 'record',
    format: 'csv',
    fields: fields.join(','),
  });
  const text = await res.text();
  return parseCsv(text);
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
