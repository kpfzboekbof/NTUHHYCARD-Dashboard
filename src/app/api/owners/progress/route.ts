import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { getAssignments } from '@/lib/owner-store';
import { getCatalog } from '@/lib/catalog/store';
import { hasDatabase } from '@/lib/db/client';
import { listPeople, type Person } from '@/lib/people/repo';
import { lastNudgeByPerson } from '@/lib/db/outbound-mail';
import { readySinceByCell } from '@/lib/db/events';
import { redcapDirectory } from '@/lib/state/backlog-source';
import { computeProgress, computeUnitTotals, type PersonProgress } from '@/lib/state/progress';
import { attributeCredit, summarizeActivity, type OwnerCredit } from '@/lib/state/activity';
import { groupByBlocker, groupByBlockerPerOwner, type BlockerGroup } from '@/lib/state/blockers';
import { ownersForUnits } from '@/lib/state/ownership';
import { defineView, readView } from '@/lib/views/view';
import { VIEW } from '@/lib/views/keys';
import { matrixView } from '@/lib/views/matrix';
import { redcapLogs } from '@/lib/views/logs';
import type { WorkState } from '@/lib/state/types';
import type { ViewMeta } from '@/types';

/**
 * GET /api/owners/progress — the per-person view of §9.1.
 *
 * Replaces numbers that were wrong in a specific, unfair way: the old grade
 * divided completed cells by a flat batch target, so somebody owning an
 * ICU-only form was measured against 6,000 patients when about 2,200 could ever
 * apply, and their score could not exceed 37% however complete their work was.
 * Numerator and denominator are now the same population, blocked work is out of
 * both, and 落後 additionally requires something to have actually been sitting.
 *
 * Manager-only: it carries addresses, the mail history and the button that
 * chases a real person.
 *
 * Composed from the matrix view and the REDCap log view — cheap once those
 * exist, so it rebuilds before answering whenever either has moved on (the
 * matrix invalidates it when a build lands) or the operator changes who owns
 * what.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const LOG_MONTHS = 3;
/** Saves inside this many days keep somebody off the stalled list. */
const ACTIVITY_WINDOW_DAYS = 14;

export interface UnassignedUnit {
  unitId: string;
  label: string;
  counts: Record<WorkState, number>;
  /** Applicable and not blocked — work nobody is going to do. */
  workable: number;
}

export interface OwnerRow extends PersonProgress {
  /** What REDCap's log says about who actually saved this work. */
  credit: OwnerCredit | null;
  /** When a nudge last actually left for them. Null means never. */
  lastNudgedAt: string | null;
  /** Why their own work is stuck, largest group first. */
  blockedBy: BlockerGroup[];
}

function emptyCounts(): Record<WorkState, number> {
  return {
    not_applicable: 0, blocked: 0, ready: 0,
    in_progress: 0, entered_awaiting_verify: 0, complete: 0,
  };
}

const ownersProgressView = defineView({
  key: VIEW.ownersProgress,
  freshSeconds: 600,
  onInvalidate: 'rebuild',

  async build(ctx) {
    const matrix = await readView(matrixView, { force: ctx.force });

    const noPeople: Promise<Person[]> = Promise.resolve([]);
    const noMap: () => Promise<Map<string, string>> = () => Promise.resolve(new Map());
    const [catalog, assignments, people, directory, logs, lastNudged, readySince] = await Promise.all([
      getCatalog(),
      getAssignments(),
      hasDatabase() ? listPeople(true).catch(() => []) : noPeople,
      redcapDirectory(),
      redcapLogs(LOG_MONTHS, ctx),
      hasDatabase() ? lastNudgeByPerson().catch(noMap) : noMap(),
      hasDatabase() ? readySinceByCell().catch(noMap) : noMap(),
    ]);

    // Kinds come from the catalog rather than the stored matrix so a snapshot
    // written before this route existed cannot silently grade a verify unit as
    // though it were an assistant's.
    const catalogById = new Map(catalog.units.map(u => [u.unitId, u]));
    const units = matrix.data.units.map(unit => ({
      unitId: unit.unitId,
      label: unit.label,
      redcapForm: unit.redcapForm,
      deepLinkPage: unit.deepLinkPage,
      kind: catalogById.get(unit.unitId)?.kind ?? 'full_form',
      ruleType: catalogById.get(unit.unitId)?.completionRule.type,
    }));
    const { records } = matrix.data;

    const { byUsername: activity, exportStart } = summarizeActivity(logs, {
      windowDays: ACTIVITY_WINDOW_DAYS,
    });

    const progress = computeProgress({
      records,
      units,
      assignments,
      people,
      directory,
      activity,
      readySince,
      staleDays: catalog.settings.staleDays,
    });

    const credit = attributeCredit({ records, units, assignments, logs });

    const blockerInput = { records, units, assignments, people, directory };
    const blockedByOwner = groupByBlockerPerOwner(blockerInput);

    const rows: OwnerRow[] = progress.map(person => ({
      ...person,
      credit: credit.byOwner.get(person.username) ?? null,
      lastNudgedAt: person.personId ? lastNudged.get(person.personId) ?? null : null,
      blockedBy: (blockedByOwner.get(person.username) ?? []).slice(0, 5),
    }));

    // Units nobody is named on. They produce no queue, no reminder and no score,
    // so without this bucket their backlog is invisible rather than zero.
    const owned = ownersForUnits(units, assignments);
    const unassignedById = new Map<string, UnassignedUnit>();
    for (const unit of units) {
      if (owned.has(unit.unitId)) continue;
      unassignedById.set(unit.unitId, { unitId: unit.unitId, label: unit.label, counts: emptyCounts(), workable: 0 });
    }
    if (unassignedById.size > 0) {
      for (const record of records) {
        for (const cell of record.cells) {
          const bucket = unassignedById.get(cell.unitId);
          if (!bucket) continue;
          bucket.counts[cell.state] += 1;
          if (cell.state !== 'not_applicable' && cell.state !== 'blocked') bucket.workable += 1;
        }
      }
    }
    const unassigned = [...unassignedById.values()]
      .filter(u => u.workable > 0 || u.counts.blocked > 0)
      .sort((a, b) => b.workable - a.workable);

    return {
      people: rows,
      // The form-first view: each unit against its own population, owner
      // attached, unassigned rows included.
      units: computeUnitTotals({ records, units, assignments, people, directory }),
      unassigned,
      blockers: groupByBlocker(blockerInput),
      attribution: {
        attributableSaves: credit.attributableSaves,
        formlessSaves: credit.formlessSaves,
        exportStart: credit.exportStart,
      },
      activity: { exportStart, windowDays: ACTIVITY_WINDOW_DAYS, logMonths: LOG_MONTHS },
      settings: { staleDays: catalog.settings.staleDays },
      /** Empty until the snapshot cron has run; without it nobody can be 落後. */
      readySinceKnown: readySince.size,
      /** The matrix this was computed from — the time the page shows. */
      fetchedAt: matrix.fetchedAt,
    };
  },
});

export type OwnersProgressResponse = Awaited<ReturnType<typeof ownersProgressView.build>> & ViewMeta;

export async function GET(request: NextRequest) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  try {
    const force = request.nextUrl.searchParams.get('noCache') === '1';
    const result = await readView(ownersProgressView, { force });
    // The freshness shown is the matrix's: the numbers are only as current as
    // the export they came from, and it is the matrix that refreshes.
    const matrix = await readView(matrixView);
    const body: OwnersProgressResponse = {
      ...result.data,
      fetchedAt: matrix.fetchedAt,
      stale: result.stale || matrix.stale,
      refreshing: result.refreshing || matrix.refreshing,
      refreshFailed: result.refreshFailed || matrix.refreshFailed,
    };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
