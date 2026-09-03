import { NextRequest, NextResponse } from 'next/server';
import { getDataEntryBase } from '@/lib/redcap/deep-link';
import { HOSPITALS } from '@/config/hospitals';
import { recentHandoffKeys } from '@/lib/db/events';
import { readView } from '@/lib/views/view';
import { attachOwners, matrixView, UNASSIGNED } from '@/lib/views/matrix';
import type { CellState, WorkState } from '@/lib/state/types';

/**
 * GET /api/state/matrix
 *
 * The single read API behind every work-state view. Returns per-unit counts
 * for the whole registry plus a filtered, paged slice of individual cells: at
 * target size the matrix is ~200k cells, far more than one response should
 * carry, so cells are always filtered and paged.
 *
 * Filters: unit, state, hospital, owner. Paging: limit (default 500, max 2000)
 * and offset. `noCache=1` forces a re-derivation; otherwise the last build is
 * served and refreshed behind the response (src/lib/views).
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

const ALL_STATES: WorkState[] = [
  'not_applicable', 'blocked', 'ready', 'in_progress', 'entered_awaiting_verify', 'complete',
];

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const force = params.get('noCache') === '1';

    const result = await readView(matrixView, { force });
    const snapshot = result.data;
    // Owners are joined in per request from the live assignment map, so a
    // reassignment on /assign shows here at once rather than after the next
    // hourly build.
    const units = await attachOwners(snapshot.units);

    const unit = params.get('unit');
    // Group name (總院/新竹/雲林), matching the header widget — the raw REDCap
    // codes are an implementation detail nobody filters by.
    const hospital = params.get('hospital');
    const owner = params.get('owner');
    const studyIdQuery = params.get('studyId');
    const limit = Math.min(Number(params.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(Number(params.get('offset')) || 0, 0);

    // Comma-separated states, so the queue's default view (ready|in_progress)
    // is one request rather than two stitched together client-side.
    const stateParam = params.get('state');
    const states = stateParam ? stateParam.split(',').filter(Boolean) as WorkState[] : null;
    const badState = states?.find(s => !ALL_STATES.includes(s));
    if (badState) {
      return NextResponse.json(
        { error: `未知的 state：${badState}。可用值：${ALL_STATES.join(', ')}` },
        { status: 400 },
      );
    }
    const stateSet = states ? new Set(states) : null;

    // `since=7d` (or an ISO timestamp): only cells with a recorded handoff —
    // became_ready or entered_awaiting_verify — since then. A filter over the
    // event stream, not an unread count: it is correct however often it is
    // asked, and empty until the snapshot cron has run at least twice.
    const sinceParam = params.get('since');
    let recentKeys: Set<string> | null = null;
    if (sinceParam) {
      const dayMatch = /^(\d{1,3})d$/.exec(sinceParam);
      const cutoff = dayMatch
        ? new Date(Date.now() - Number(dayMatch[1]) * 86_400_000)
        : new Date(sinceParam);
      if (Number.isNaN(cutoff.getTime())) {
        return NextResponse.json({ error: `無法解析 since：${sinceParam}（用 7d 或 ISO 時間）` }, { status: 400 });
      }
      recentKeys = await recentHandoffKeys(cutoff.toISOString());
    }

    const ownerByUnit = new Map(units.map(u => [u.unitId, u.owner]));

    // Collect only the requested window rather than materialising every match.
    const page: Array<CellState & { hospital: number; owner: string }> = [];
    let matched = 0;

    for (const record of snapshot.records) {
      if (hospital && (HOSPITALS[record.hospital] ?? String(record.hospital)) !== hospital) continue;
      if (studyIdQuery && !record.studyId.includes(studyIdQuery)) continue;

      for (const cell of record.cells) {
        if (unit && cell.unitId !== unit) continue;
        if (stateSet && !stateSet.has(cell.state)) continue;
        if (recentKeys && !recentKeys.has(`${record.studyId}|${cell.unitId}`)) continue;

        const cellOwner = ownerByUnit.get(cell.unitId) ?? UNASSIGNED;
        if (owner && cellOwner !== owner) continue;

        if (matched >= offset && page.length < limit) {
          page.push({ ...cell, hospital: record.hospital, owner: cellOwner });
        }
        matched++;
      }
    }

    const redcapBaseUrl = await getDataEntryBase();

    return NextResponse.json({
      redcapBaseUrl,
      units,
      totals: snapshot.totals,
      catalogVersion: snapshot.catalogVersion,
      catalogIsSeed: snapshot.catalogIsSeed,
      catalogReadFailed: snapshot.catalogReadFailed,
      fetchedAt: result.fetchedAt,
      stale: result.stale,
      refreshing: result.refreshing,
      refreshFailed: result.refreshFailed,
      cells: page,
      matched,
      offset,
      limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
