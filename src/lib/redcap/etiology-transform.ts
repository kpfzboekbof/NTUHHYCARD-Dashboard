export const LABELERS: { code: number; name: string }[] = [
  { code: 0, name: '范程羿' },
  { code: 3, name: '陳麒心' },
  { code: 5, name: '陳雲昶' },
  { code: 6, name: '黃嗣翔' },
  { code: 7, name: '黃俊翔' },
];

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

export interface EtiologyReviewer {
  labelerCode: number;
  name: string;
  complete: boolean;
}

export interface EtiologyRecord {
  studyId: string;
  finalCode: number | null;
  finalLabel: string | null;
  reviewers: EtiologyReviewer[];
}

export interface EtiologyStats {
  total: number;
  finalComplete: number;
  finalIncomplete: number;
}

export interface EtiologyResponse {
  records: EtiologyRecord[];
  stats: EtiologyStats;
  fetchedAt: string;
}

export function transformEtiology(rawRows: Record<string, string>[]): {
  records: EtiologyRecord[];
  stats: EtiologyStats;
} {
  // Group by study_id
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
  }>();

  for (const row of rawRows) {
    const id = row.study_id;
    if (!id || excludedIds.has(id)) continue;

    let entry = map.get(id);
    if (!entry) {
      entry = { finalCode: null, completedLabelers: new Set() };
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
      // Repeat row — read labeler + complete status
      const labeler = row.labeler;
      const complete = row.ntuh_nhi_etiology_complete === '2';
      if (labeler !== '' && complete) {
        entry.completedLabelers.add(parseInt(labeler));
      }
    }
  }

  const records: EtiologyRecord[] = [];
  for (const [studyId, entry] of map) {
    records.push({
      studyId,
      finalCode: entry.finalCode,
      finalLabel: entry.finalCode !== null ? (ETIOLOGY_FINAL_MAP[entry.finalCode] ?? `Code ${entry.finalCode}`) : null,
      reviewers: LABELERS.map(l => ({
        labelerCode: l.code,
        name: l.name,
        complete: entry.completedLabelers.has(l.code),
      })),
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
