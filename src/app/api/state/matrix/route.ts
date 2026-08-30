import { NextRequest, NextResponse } from 'next/server';
import { getCachedAsync, setCached, clearAllCache } from '@/lib/cache';
import { fetchRecordsByFields, fetchEtiologyStatus, fetchUsers } from '@/lib/redcap/client';
import { getCatalogSource } from '@/lib/catalog/store';
import { LEGACY_FORM_BY_UNIT_ID } from '@/lib/catalog/seed';
import { getAssignments } from '@/lib/owner-store';
import { getLabelers } from '@/lib/labelers';
import { buildMatrix } from '@/lib/state/matrix';
import { catalogFieldSet } from '@/lib/state/snapshot';
import type { CellState, WorkState } from '@/lib/state/types';
import type { User } from '@/types';

/**
 * GET /api/state/matrix
 *
 * The single read API behind every work-state view. Returns per-unit counts
 * for the whole registry plus a filtered, paged slice of individual cells —
 * the full matrix is ~200k cells at target size, far too much for one payload.
 *
 * Filters: unit, state, hospital, owner, screeningPending, blocked.
 * Paging: limit (default 500, max 2000), offset.
 */

const CACHE_KEY = 'state-matrix';
const USERS_CACHE_KEY = 'redcap_users';
const UNASSIGNED = '未指派';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

const ALL_STATES: WorkState[] = [
  'not_applicable', 'blocked', 'ready', 'in_progress', 'entered_awaiting_verify', 'complete',
];

interface UnitSummary {
  unitId: string;
  label: string;
  redcapForm: string;
  deepLinkPage: string;
  category: string;
  sortOrder: number;
  owner: string;
  counts: Record<WorkState, number>;
}

interface MatrixSnapshot {
  units: UnitSummary[];
  cells: Array<CellState & { hospital: number; owner: string }>;
  totals: {
    records: number;
    excluded: number;
    screeningPending: number;
    /** Records whose every applicable unit is complete. */
    fullyComplete: number;
  };
  catalogVersion: number;
  catalogIsSeed: boolean;
  fetchedAt: string;
}

function emptyCounts(): Record<WorkState, number> {
  return {
    not_applicable: 0, blocked: 0, ready: 0,
    in_progress: 0, entered_awaiting_verify: 0, complete: 0,
  };
}

async function buildSnapshot(): Promise<MatrixSnapshot> {
  const [{ catalog, version, isSeed }, assignments, labelers] = await Promise.all([
    getCatalogSource(),
    getAssignments(),
    getLabelers(),
  ]);

  let users = await getCachedAsync<User[]>(USERS_CACHE_KEY);
  if (!users) {
    const rawUsers = await fetchUsers();
    users = rawUsers.map(u => ({ username: u.username, name: `${u.lastname}${u.firstname}` }));
    setCached(USERS_CACHE_KEY, users, 1800);
  }

  const [rows, etiologyRows] = await Promise.all([
    fetchRecordsByFields(catalogFieldSet(catalog)),
    fetchEtiologyStatus(),
  ]);

  const { records } = buildMatrix({ catalog, rows, etiologyRows, labelers });

  // Owners still come from the form-keyed assignment map. Phase 5 replaces
  // this with assignment rules; the shape of the response does not change.
  const ownerOf = new Map<string, string>();
  for (const unit of catalog.units) {
    const formName = LEGACY_FORM_BY_UNIT_ID[unit.unitId] ?? unit.unitId;
    const username = assignments[formName];
    const user = username ? users.find(u => u.username === username) : undefined;
    ownerOf.set(unit.unitId, user?.name || username || UNASSIGNED);
  }

  const visibleUnits = catalog.units.filter(u => !u.hidden);
  const summaries = new Map<string, UnitSummary>(
    visibleUnits.map(unit => [unit.unitId, {
      unitId: unit.unitId,
      label: unit.label,
      redcapForm: unit.redcapForm,
      deepLinkPage: unit.deepLinkPage,
      category: unit.category,
      sortOrder: unit.sortOrder,
      owner: ownerOf.get(unit.unitId) ?? UNASSIGNED,
      counts: emptyCounts(),
    }]),
  );

  const cells: MatrixSnapshot['cells'] = [];
  let excluded = 0;
  let screeningPending = 0;
  let fullyComplete = 0;

  for (const record of records) {
    if (record.excluded) excluded++;
    if (record.screeningPending) screeningPending++;

    // Patient-level progress: the unit the registry is actually counted in.
    const applicable = record.cells.filter(c => c.state !== 'not_applicable');
    if (!record.excluded && applicable.length > 0 && applicable.every(c => c.state === 'complete')) {
      fullyComplete++;
    }

    for (const cell of record.cells) {
      const summary = summaries.get(cell.unitId);
      if (summary) summary.counts[cell.state] += 1;
      cells.push({ ...cell, hospital: record.hospital, owner: ownerOf.get(cell.unitId) ?? UNASSIGNED });
    }
  }

  return {
    units: [...summaries.values()].sort((a, b) => a.sortOrder - b.sortOrder),
    cells,
    totals: { records: records.length, excluded, screeningPending, fullyComplete },
    catalogVersion: version,
    catalogIsSeed: isSeed,
    fetchedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const noCache = params.get('noCache') === '1';
    if (noCache) clearAllCache();

    let snapshot = !noCache ? await getCachedAsync<MatrixSnapshot>(CACHE_KEY) : undefined;
    if (!snapshot) {
      snapshot = await buildSnapshot();
      setCached(CACHE_KEY, snapshot, 300);
    }

    const unit = params.get('unit');
    const state = params.get('state');
    const hospital = params.get('hospital');
    const owner = params.get('owner');
    const limit = Math.min(Number(params.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(Number(params.get('offset')) || 0, 0);

    if (state && !ALL_STATES.includes(state as WorkState)) {
      return NextResponse.json(
        { error: `未知的 state：${state}。可用值：${ALL_STATES.join(', ')}` },
        { status: 400 },
      );
    }

    const filtered = snapshot.cells.filter(cell => {
      if (unit && cell.unitId !== unit) return false;
      if (state && cell.state !== state) return false;
      if (hospital && String(cell.hospital) !== hospital) return false;
      if (owner && cell.owner !== owner) return false;
      return true;
    });

    return NextResponse.json({
      units: snapshot.units,
      totals: snapshot.totals,
      catalogVersion: snapshot.catalogVersion,
      catalogIsSeed: snapshot.catalogIsSeed,
      fetchedAt: snapshot.fetchedAt,
      cells: filtered.slice(offset, offset + limit),
      matched: filtered.length,
      offset,
      limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
