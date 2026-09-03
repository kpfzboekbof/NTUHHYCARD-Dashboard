import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { hasDatabase } from '@/lib/db/client';
import { latestCronRuns, listCronRuns } from '@/lib/db/cron-runs';
import { jobHealth, JOB_SPECS, type JobHealth } from '@/lib/cron/health';
import { baselineStatus, type BaselineStatus } from '@/lib/state/baseline';
import { durableTier, listViewHeads, type ViewHead } from '@/lib/views/store';

/**
 * GET /api/admin/cron-runs — did the background jobs actually run?
 *
 * A scheduled job runs with nobody watching, so its success and its failure
 * are equally silent. Until this existed the only record was the platform's
 * log: it expires, it lives outside the dashboard, and it cannot be checked
 * from the page that depends on the job having run.
 */

export const runtime = 'nodejs';

export interface CronStatusResponse {
  jobs: JobHealth[];
  runs: Awaited<ReturnType<typeof listCronRuns>>;
  /**
   * The diff baseline, read independently of the ledger. It is the only
   * evidence of snapshots that ran before the ledger existed, so a fresh table
   * does not make a working job look like it never fired.
   */
  baseline: BaselineStatus;
  /**
   * The derived views: when each was last built, how big, and whether a
   * background rebuild is running or has been giving up. A refresh that dies
   * at the platform's time limit is as silent as a cron that never fires, and
   * this is where it shows.
   */
  views: ViewHead[];
  viewTier: ReturnType<typeof durableTier>;
  hasDatabase: boolean;
  fetchedAt: string;
}

export async function GET(request: NextRequest) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  try {
    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit')) || 50, 200);
    const [latest, runs, baseline, views] = await Promise.all([
      hasDatabase() ? latestCronRuns() : Promise.resolve(new Map()),
      hasDatabase() ? listCronRuns(undefined, limit) : Promise.resolve([]),
      baselineStatus(),
      listViewHeads(),
    ]);

    const now = new Date();
    const jobs = JOB_SPECS.map(spec => {
      const entry = latest.get(spec.job);
      return jobHealth({
        spec,
        last: entry?.last ?? null,
        lastOk: entry?.lastOk ?? null,
        recent: runs.filter(r => r.job === spec.job),
        now,
      });
    });

    return NextResponse.json({
      jobs,
      runs,
      baseline,
      views,
      viewTier: durableTier(),
      hasDatabase: hasDatabase(),
      fetchedAt: now.toISOString(),
    } satisfies CronStatusResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
