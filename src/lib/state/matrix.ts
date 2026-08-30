import { causeCodeToFinalCode, transformEtiology, type Labeler } from '@/lib/redcap/etiology-transform';
import type { CatalogDoc } from '@/lib/catalog/types';
import type { RedcapRow } from '@/lib/redcap/client';
import { deriveRecord } from './derive';
import { buildSnapshots } from './snapshot';
import type { AdjudicationSummary, RecordDerivation } from './types';

/**
 * Builds the whole patient × work-unit state matrix from one REDCap snapshot.
 *
 * Every view — the personal queue, the heatmap, per-person progress — reads
 * this one matrix, so no page invents its own idea of what "done" means.
 */

export interface MatrixInput {
  catalog: CatalogDoc;
  /** Rows from the catalog-derived record export. */
  rows: RedcapRow[];
  /** Rows from the etiology export, for consensus state. */
  etiologyRows?: RedcapRow[];
  labelers?: Labeler[];
  batchCutoff?: (slug: string) => number | null;
}

export interface Matrix {
  records: RecordDerivation[];
}

/**
 * Reuse the etiology transform for consensus so the voting rules keep a single
 * implementation — the meeting flow and the state engine must never disagree.
 */
function adjudicationByRecord(
  etiologyRows: RedcapRow[],
  labelers: Labeler[],
): Map<string, AdjudicationSummary> {
  const { records } = transformEtiology(etiologyRows, labelers);
  const summaries = new Map<string, AdjudicationSummary>();

  for (const record of records) {
    summaries.set(record.studyId, {
      completedVotes: record.completedCount,
      consensus: record.consensusStatus,
      mappable: causeCodeToFinalCode(record.consensusCauseCode) !== null,
      finalWritten: record.finalCode !== null,
    });
  }

  return summaries;
}

export function buildMatrix(input: MatrixInput): Matrix {
  const { catalog, rows, etiologyRows = [], labelers = [], batchCutoff } = input;

  const snapshots = buildSnapshots(rows);
  const adjudications = etiologyRows.length > 0
    ? adjudicationByRecord(etiologyRows, labelers)
    : new Map<string, AdjudicationSummary>();

  const units = catalog.units.filter(unit => !unit.hidden);
  const records: RecordDerivation[] = snapshots.map(snapshot =>
    deriveRecord(snapshot, {
      units,
      batchCutoff,
      adjudication: adjudications.get(snapshot.studyId),
    }),
  );

  records.sort((a, b) => Number(a.studyId) - Number(b.studyId));
  return { records };
}
