import { runCronJob } from '@/lib/cron/run';
import { deriveCurrentMatrix } from '@/lib/state/build';
import { diffMatrices } from '@/lib/state/diff';
import { readBaseline, writeBaseline } from '@/lib/state/baseline';
import { buildUnitRouting } from '@/lib/state/routing';
import { insertWorkEvents } from '@/lib/db/events';
import { hasDatabase } from '@/lib/db/client';
import { listPeople } from '@/lib/people/repo';
import { getAssignments } from '@/lib/owner-store';

/**
 * GET /api/cron/snapshot — take a snapshot, diff it against the last one,
 * record the handoffs.
 *
 * The queue never depends on this having run: every view re-derives from the
 * latest REDCap export. What this run adds is durable "since when" — the
 * events behind the queue's new-handoff facet and its aging. Missing a run
 * therefore delays information, never loses work, which is what makes a daily
 * cadence (the cheapest Vercel plan) acceptable and a manual trigger safe.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * One retry after a pause: the REDCap server has been seen answering 500 — and
 * 200-with-an-empty-body — under load, and both recover. Persistent failure is
 * the watchdog's to report, not this route's to solve.
 */
async function deriveWithRetry() {
  try {
    return await deriveCurrentMatrix();
  } catch (first) {
    console.error('cron/snapshot: first derive failed, retrying in 10s:', first);
    await new Promise(resolve => setTimeout(resolve, 10_000));
    return deriveCurrentMatrix();
  }
}

export async function GET(request: Request) {
  const startedAt = Date.now();

  return runCronJob('snapshot', request, async () => {
    const [matrix, baseline] = await Promise.all([deriveWithRetry(), readBaseline()]);

    // A partial export can pass the empty-body guard and still be missing
    // half the registry. Records only ever accumulate here, so a collapse
    // against the baseline is an export failure, and persisting it would both
    // spray thousands of false events and poison the next diff.
    if (baseline && matrix.records.length < baseline.records.length * 0.5) {
      return {
        ok: false,
        error: `匯出僅 ${matrix.records.length} 筆，基準線有 ${baseline.records.length} 筆——視為 REDCap 匯出失敗，未更新基準線`,
      };
    }

    const events = baseline ? diffMatrices(baseline.records, matrix.records) : [];

    // Baseline first, events second — losing beats duplicating. If the insert
    // fails after the baseline advanced, this window's events are gone, which
    // by design costs only their "since when" (the queue re-derives). The
    // reverse order would replay the same diff next run and double-count every
    // handoff, and work_event has no natural key to dedupe on.
    await writeBaseline({ fetchedAt: matrix.fetchedAt, records: matrix.records });

    let eventsWritten = 0;
    if (hasDatabase() && events.length > 0) {
      const [assignments, people] = await Promise.all([getAssignments(), listPeople(true)]);
      const unitIds = [...new Set(events.map(e => e.unitId))];
      const routing = buildUnitRouting(unitIds, assignments, people);
      eventsWritten = await insertWorkEvents(events, matrix.fetchedAt, routing);
    }

    return {
      ok: true,
      result: {
        records: matrix.records.length,
        firstRun: !baseline,
        baselineWas: baseline?.fetchedAt ?? null,
        eventsFound: events.length,
        eventsWritten,
        tookMs: Date.now() - startedAt,
      },
    };
  });
}
