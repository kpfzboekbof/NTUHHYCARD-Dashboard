import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/auth/cron';
import { failCronRun, finishCronRun, startCronRun } from '@/lib/db/cron-runs';

/**
 * Authorise a scheduled job, record that it ran, and answer.
 *
 * The wrapper exists for one property: the ledger row cannot be left open by a
 * route that returns early or throws. Every exit from `work` — success, a
 * refusal it decided on itself, or an exception — closes the row on the way
 * out. The only rows without an ending are runs that genuinely never reported
 * one, which is precisely what the ledger is for.
 */

export type CronOutcome =
  | { ok: true; result: Record<string, unknown> }
  /** The job ran and decided not to proceed — a refusal, not a crash. */
  | { ok: false; error: string; status?: number; result?: Record<string, unknown> };

export async function runCronJob(
  job: string,
  request: Request,
  work: () => Promise<CronOutcome>,
): Promise<NextResponse> {
  const auth = await authorizeCron(request);
  // Unauthorised callers are not a run: recording them would fill the ledger
  // with other people's probes and bury the runs that matter.
  if (!auth.ok) return NextResponse.json({ error: '未授權' }, { status: 401 });

  // A ledger failure must never stop the job it is only observing.
  const runId = await startCronRun({ job, trigger: auth.trigger, actor: auth.actor })
    .catch(() => null);

  try {
    const outcome = await work();
    if (outcome.ok) {
      await finishCronRun(runId, outcome.result).catch(() => {});
      return NextResponse.json({ ok: true, ...outcome.result });
    }
    await failCronRun(runId, outcome.error).catch(() => {});
    return NextResponse.json({ error: outcome.error, ...outcome.result }, { status: outcome.status ?? 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`cron/${job} failed:`, error);
    await failCronRun(runId, message).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
