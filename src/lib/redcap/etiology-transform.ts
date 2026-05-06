export interface Labeler {
  code: number;
  name: string;
  email?: string;
}

export const ETIOLOGY_FINAL_MAP: Record<number, string> = {
  0: 'Medical: Presumed cardiac/unknown',
  1: 'Medical: Anaphylaxis',
  2: 'Medical: Respiratory',
  3: 'Medical: Terminal illness',
  4: 'Medical: SUID',
  5: 'Medical: Other medical',
  6: 'Medical: Unknown',
  7: 'Trauma: Penetrating',
  8: 'Trauma: Blunt',
  9: 'Trauma: Burn',
  10: 'Drug overdose',
  11: 'Drowning',
  12: 'Electrocution',
  13: 'Asphyxial: Hanging',
  14: 'Asphyxial: Foreign body',
  15: 'Asphyxial: Suffocation or strangulation',
  16: 'Asphyxial: Others',
};

/**
 * Map a consensus causeCode (output of computeCauseCode) to the etiology_final
 * integer code. Returns null when there is no direct 1:1 mapping (e.g. trauma
 * "others" 1-3, or any unexpected sub-category) — in those cases the consensus
 * meeting will need to choose etiology_final manually.
 */
const CAUSE_TO_FINAL: Record<string, number> = {
  // cause_all = 0 (Medical), cause_med
  '0-0': 0, '0-1': 1, '0-2': 2, '0-3': 3, '0-4': 4, '0-5': 5, '0-6': 6,
  // cause_all = 1 (Traumatic), cause_tra: 0=blunt, 1=penetrating, 2=burn, 3=others
  '1-0': 8, '1-1': 7, '1-2': 9,
  // cause_all = 2/3/4 (no sub)
  '2': 10, '3': 11, '4': 12,
  // cause_all = 5 (Asphyxial), cause_asphy: 0=foreign body, 1=hanging, 2=suffocation, 3=others
  '5-0': 14, '5-1': 13, '5-2': 15, '5-3': 16,
};

export function causeCodeToFinalCode(causeCode: string | null): number | null {
  if (!causeCode) return null;
  return CAUSE_TO_FINAL[causeCode] ?? null;
}

/**
 * Human-readable label for each labeler-vote causeCode, ordered for the
 * consensus-meeting reference panel. Grouped by main category so the reader
 * can scan along a row.
 */
export const CAUSE_CODE_GROUPS: Array<{
  main: string;            // displayed main-category number, e.g. "0", "1", "2"
  title: string;           // category name, e.g. "Medical", "Traumatic"
  items: Array<{ code: string; label: string }>;
}> = [
  {
    main: '0', title: 'Medical', items: [
      { code: '0-0', label: 'presumed cardiac' },
      { code: '0-1', label: 'anaphylaxis' },
      { code: '0-2', label: 'respiratory' },
      { code: '0-3', label: 'terminal illness' },
      { code: '0-4', label: 'SUID' },
      { code: '0-5', label: 'other medical' },
      { code: '0-6', label: 'unknown' },
    ],
  },
  {
    main: '1', title: 'Traumatic', items: [
      { code: '1-0', label: 'blunt' },
      { code: '1-1', label: 'penetrating' },
      { code: '1-2', label: 'burn injury' },
      { code: '1-3', label: 'others' },
    ],
  },
  { main: '2', title: 'Drug overdose', items: [{ code: '2', label: 'drug overdose' }] },
  { main: '3', title: 'Drowning',      items: [{ code: '3', label: 'drowning' }] },
  { main: '4', title: 'Electrocution', items: [{ code: '4', label: 'electrocution' }] },
  {
    main: '5', title: 'Asphyxial', items: [
      { code: '5-0', label: 'foreign-body airway obstruction' },
      { code: '5-1', label: 'hanging' },
      { code: '5-2', label: 'suffocation / strangulation' },
      { code: '5-3', label: 'others' },
    ],
  },
];

export type ConsensusStatus = 'yellow' | 'green' | 'red';

export interface EtiologyReviewer {
  labelerCode: number;
  name: string;
  complete: boolean;
  causeCode: string | null;
}

export interface EtiologyRecord {
  studyId: string;
  regNo: string;                       // 病歷號 (REDCap field: reg_no)
  finalCode: number | null;
  finalLabel: string | null;
  reviewers: EtiologyReviewer[];
  consensusStatus: ConsensusStatus;
  completedCount: number;
  /** Majority causeCode among completed reviewers when the row is "green"; null otherwise. */
  consensusCauseCode: string | null;
}

export interface EtiologyStats {
  total: number;
  finalComplete: number;
  finalIncomplete: number;
}

export interface EtiologyResponse {
  records: EtiologyRecord[];
  stats: EtiologyStats;
  labelers: Labeler[];
  fetchedAt: string;
}

/** Build full cause code from repeat-instrument row fields */
function computeCauseCode(row: Record<string, string>): string | null {
  const main = row.cause_all_etiology_new;
  if (main === undefined || main === '') return null;

  const mainNum = parseInt(main);
  let sub: string | undefined;

  switch (mainNum) {
    case 0:
      sub = row.cause_med_etiology_new;
      break;
    case 1:
      sub = row.cause_tra_etiology_new;
      break;
    case 5:
      sub = row.cause_asphy_etiology_new;
      break;
    case 2:
    case 3:
    case 4:
      return main; // no subcategory
    default:
      return main; // unexpected value, show raw
  }

  if (sub !== undefined && sub !== '') {
    return `${main}-${sub}`;
  }
  return main; // subcategory not yet filled
}

/** Determine consensus status + majority causeCode (when green) */
function computeConsensus(reviewers: EtiologyReviewer[]): {
  status: ConsensusStatus;
  majorityCauseCode: string | null;
} {
  const completed = reviewers.filter(r => r.complete && r.causeCode !== null);
  const total = completed.length;

  if (total < 3) return { status: 'yellow', majorityCauseCode: null };

  // Count votes by full causeCode
  const votes = new Map<string, number>();
  for (const r of completed) {
    votes.set(r.causeCode!, (votes.get(r.causeCode!) || 0) + 1);
  }

  let maxCount = 0;
  let majority: string | null = null;
  for (const [code, count] of votes) {
    if (count > maxCount) {
      maxCount = count;
      majority = code;
    }
  }
  const minorityCount = total - maxCount;

  // Green: unanimous (3:0, 4:0, 5:0) or one dissenter with majority ≥ 3 (3:1, 4:1)
  if (minorityCount === 0) return { status: 'green', majorityCauseCode: majority };
  if (minorityCount === 1 && maxCount >= 3) return { status: 'green', majorityCauseCode: majority };

  return { status: 'red', majorityCauseCode: null };
}

export function transformEtiology(rawRows: Record<string, string>[], labelers: Labeler[]): {
  records: EtiologyRecord[];
  stats: EtiologyStats;
} {
  // First pass: identify excluded study_ids
  const excludedIds = new Set<string>();
  for (const row of rawRows) {
    if (!row.redcap_repeat_instrument && row.exclusion !== undefined && row.exclusion !== '' && row.exclusion !== '0') {
      excludedIds.add(row.study_id);
    }
  }

  const map = new Map<string, {
    regNo: string;
    finalCode: number | null;
    completedLabelers: Set<number>;
    labelerCauseCodes: Map<number, string | null>;
  }>();

  for (const row of rawRows) {
    const id = row.study_id;
    if (!id || excludedIds.has(id)) continue;

    let entry = map.get(id);
    if (!entry) {
      entry = { regNo: '', finalCode: null, completedLabelers: new Set(), labelerCauseCodes: new Map() };
      map.set(id, entry);
    }

    const isRepeat = row.redcap_repeat_instrument === 'ntuh_nhi_etiology';

    if (!isRepeat) {
      // Main row — read etiology_final + reg_no (病歷號)
      const finalVal = row.etiology_final;
      if (finalVal !== undefined && finalVal !== '') {
        entry.finalCode = parseInt(finalVal);
      }
      if (row.reg_no !== undefined && row.reg_no !== '') {
        entry.regNo = row.reg_no;
      }
    } else {
      // Repeat row — read labeler + complete status + cause code
      const labeler = row.labeler;
      const complete = row.ntuh_nhi_etiology_complete === '2';
      if (labeler !== '') {
        const labelerNum = parseInt(labeler);
        if (complete) {
          entry.completedLabelers.add(labelerNum);
          entry.labelerCauseCodes.set(labelerNum, computeCauseCode(row));
        }
      }
    }
  }

  const records: EtiologyRecord[] = [];
  for (const [studyId, entry] of map) {
    const reviewersList = labelers.map(l => ({
      labelerCode: l.code,
      name: l.name,
      complete: entry.completedLabelers.has(l.code),
      causeCode: entry.labelerCauseCodes.get(l.code) ?? null,
    }));

    const { status, majorityCauseCode } = computeConsensus(reviewersList);

    records.push({
      studyId,
      regNo: entry.regNo,
      finalCode: entry.finalCode,
      finalLabel: entry.finalCode !== null ? (ETIOLOGY_FINAL_MAP[entry.finalCode] ?? `Code ${entry.finalCode}`) : null,
      reviewers: reviewersList,
      consensusStatus: status,
      completedCount: entry.completedLabelers.size,
      consensusCauseCode: majorityCauseCode,
    });
  }

  // Sort by studyId numerically
  records.sort((a, b) => parseInt(a.studyId) - parseInt(b.studyId));

  const stats: EtiologyStats = {
    total: records.length,
    finalComplete: records.filter(r => r.finalCode !== null).length,
    finalIncomplete: records.filter(r => r.finalCode === null).length,
  };

  return { records, stats };
}
