export interface Labeler {
  code: number;
  name: string;
  email?: string;
}

export const ETIOLOGY_FINAL_MAP: Record<number, string> = {
  0: 'Presumed cardiac/unknown',
  1: 'Anaphylaxis',
  2: 'Respiratory',
  3: 'Terminal illness',
  4: 'SUID',
  5: 'Other medical',
  6: 'Unknown',
  7: 'Trauma: Penetrating',
  8: 'Trauma: Blunt',
  9: 'Trauma: Burn',
  10: 'Drug overdose',
  11: 'Drowning',
  12: 'Electrocution',
  13: 'Asphyxial: Hanging',
  14: 'Asphyxial: Foreign body',
  15: 'Asphyxial: Suffocation/strangulation',
  16: 'Asphyxial: Others',
};

export type ConsensusStatus = 'yellow' | 'green' | 'red';

export interface EtiologyReviewer {
  labelerCode: number;
  name: string;
  complete: boolean;
  causeCode: string | null;
}

export interface EtiologyRecord {
  studyId: string;
  finalCode: number | null;
  finalLabel: string | null;
  reviewers: EtiologyReviewer[];
  consensusStatus: ConsensusStatus;
  completedCount: number;
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

/** Determine consensus status from completed reviewers' cause codes */
function computeConsensusStatus(reviewers: EtiologyReviewer[]): ConsensusStatus {
  const completed = reviewers.filter(r => r.complete && r.causeCode !== null);
  const total = completed.length;

  if (total < 3) return 'yellow';

  // Count votes by full causeCode
  const votes = new Map<string, number>();
  for (const r of completed) {
    votes.set(r.causeCode!, (votes.get(r.causeCode!) || 0) + 1);
  }

  let maxCount = 0;
  for (const count of votes.values()) {
    if (count > maxCount) maxCount = count;
  }
  const minorityCount = total - maxCount;

  // Green: unanimous (3:0, 4:0, 5:0) or one dissenter with majority ≥ 3 (3:1, 4:1)
  if (minorityCount === 0) return 'green';
  if (minorityCount === 1 && maxCount >= 3) return 'green';

  return 'red';
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
    finalCode: number | null;
    completedLabelers: Set<number>;
    labelerCauseCodes: Map<number, string | null>;
  }>();

  for (const row of rawRows) {
    const id = row.study_id;
    if (!id || excludedIds.has(id)) continue;

    let entry = map.get(id);
    if (!entry) {
      entry = { finalCode: null, completedLabelers: new Set(), labelerCauseCodes: new Map() };
      map.set(id, entry);
    }

    const isRepeat = row.redcap_repeat_instrument === 'ntuh_nhi_etiology';

    if (!isRepeat) {
      // Main row — read etiology_final
      const finalVal = row.etiology_final;
      if (finalVal !== undefined && finalVal !== '') {
        entry.finalCode = parseInt(finalVal);
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

    records.push({
      studyId,
      finalCode: entry.finalCode,
      finalLabel: entry.finalCode !== null ? (ETIOLOGY_FINAL_MAP[entry.finalCode] ?? `Code ${entry.finalCode}`) : null,
      reviewers: reviewersList,
      consensusStatus: computeConsensusStatus(reviewersList),
      completedCount: entry.completedLabelers.size,
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
