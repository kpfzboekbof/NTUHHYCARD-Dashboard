import { fetchEtiologyStatus, fetchRecordsByFieldsSplit } from '@/lib/redcap/client';
import { getCatalogSource } from '@/lib/catalog/store';
import { getHiddenForms } from '@/lib/owner-store';
import { getLabelers } from '@/lib/labelers';
import { LEGACY_FORM_BY_UNIT_ID } from '@/lib/catalog/seed';
import { buildMatrix } from './matrix';
import { catalogFieldSet } from './snapshot';
import type { RecordDerivation } from './types';

/** The unit metadata every consumer of the matrix wants alongside the cells. */
export interface UnitMeta {
  unitId: string;
  label: string;
  redcapForm: string;
  deepLinkPage: string;
  category: string;
  sortOrder: number;
}

/**
 * The one way a current state matrix is produced.
 *
 * Both the matrix API and the snapshot cron call this, so "what the operator
 * sees" and "what the diff compares" can never be built by two subtly
 * different recipes.
 */

export interface CurrentMatrix {
  records: RecordDerivation[];
  /** Visible (non-hidden) units, in catalog sort order. */
  units: UnitMeta[];
  catalogVersion: number;
  catalogIsSeed: boolean;
  catalogReadFailed: boolean;
  fetchedAt: string;
}

export async function deriveCurrentMatrix(): Promise<CurrentMatrix> {
  const [{ catalog: rawCatalog, version, isSeed, readFailed }, labelers, hiddenForms] = await Promise.all([
    getCatalogSource(),
    getLabelers(),
    getHiddenForms(),
  ]);

  // The operator's hidden-forms choice (the /assign checkboxes, defaulted from
  // `pendingEntry`) applies to the state engine too. Without this the two
  // never-entered forms would flood the queue with thousands of permanently
  // "ready" cells — exactly what hiding them was decided to prevent.
  const hidden = new Set(hiddenForms);
  const catalog = {
    ...rawCatalog,
    units: rawCatalog.units.map(unit =>
      hidden.has(LEGACY_FORM_BY_UNIT_ID[unit.unitId] ?? unit.unitId)
        ? { ...unit, hidden: true }
        : unit,
    ),
  };

  // Strictly sequential: the REDCap server slows to a crawl when the split
  // export and the etiology export run against it concurrently (measured:
  // ~64s sequential, >10min in parallel). One request in flight at a time is
  // the whole point of the split exporter.
  const rows = await fetchRecordsByFieldsSplit(catalogFieldSet(catalog));
  const etiologyRows = await fetchEtiologyStatus();

  // Same disease as the main export: an empty 200 here would silently flip
  // every consensus-gated cell (blocked↔ready) and spray false events.
  if (etiologyRows.length === 0) {
    throw new Error('REDCap etiology 匯出回傳 0 筆——視為匯出失敗');
  }

  // Observed in production: REDCap under strain answers 200 with an empty
  // body. Treating that as "no records" would blank every view and, worse,
  // let the snapshot cron persist a baseline that says all work vanished.
  if (rows.length === 0) {
    throw new Error('REDCap 匯出回傳 0 筆——視為匯出失敗，不是空的 registry');
  }

  const { records } = buildMatrix({ catalog, rows, etiologyRows, labelers });

  const units: UnitMeta[] = catalog.units
    .filter(unit => !unit.hidden)
    .map(unit => ({
      unitId: unit.unitId,
      label: unit.label,
      redcapForm: unit.redcapForm,
      deepLinkPage: unit.deepLinkPage,
      category: unit.category,
      sortOrder: unit.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    records,
    units,
    catalogVersion: version,
    catalogIsSeed: isSeed,
    catalogReadFailed: readFailed,
    fetchedAt: new Date().toISOString(),
  };
}
