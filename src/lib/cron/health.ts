import type { CronRunRow } from '@/lib/db/cron-runs';

/**
 * Turning two timestamps into the sentence the operator actually needs.
 *
 * A scheduled job has more failure modes than "working / not working", and
 * they need different fixes:
 *
 *  - `never`    — no run has ever been recorded. Either the schedule was never
 *                 registered, or every attempt was rejected before it began.
 *  - `stuck`    — a run started and never reported an ending. The platform
 *                 killed it, almost always at the function time limit. This is
 *                 the case the ledger exists for: without a row written before
 *                 the work, it is indistinguishable from `never`.
 *  - `failing`  — the last run ended and said why. There is an error to read.
 *  - `stale`    — the last success is older than this job's cadence allows.
 *                 Nothing is erroring; it simply is not being run.
 *  - `ok`       — succeeded within the window.
 *
 * Separately from all of those, `scheduleSuspect` marks a job that only ever
 * succeeds when somebody presses the button. It looks healthy by every measure
 * above and is not: the schedule is not firing, and the moment the operator
 * stops pressing, the data quietly stops.
 */

export type JobStatus = 'ok' | 'stale' | 'failing' | 'stuck' | 'running' | 'never';

export interface JobSpec {
  job: string;
  label: string;
  /** How often it is meant to run, in hours. */
  everyHours: number;
  /** Grace on top of the cadence before a late run counts as stale. */
  slackHours?: number;
  /** Longest a single run may plausibly take; beyond it, an open row is dead. */
  maxRunMinutes?: number;
}

export interface JobHealth {
  job: string;
  label: string;
  status: JobStatus;
  /** Hours since the last successful run; null when there has never been one. */
  hoursSinceSuccess: number | null;
  last: CronRunRow | null;
  lastOk: CronRunRow | null;
  /** Succeeding, but only ever by hand — the schedule is not firing. */
  scheduleSuspect: boolean;
}

export interface HealthInput {
  spec: JobSpec;
  last: CronRunRow | null;
  lastOk: CronRunRow | null;
  /** Recent runs of this job, for the manual-only check. Newest first. */
  recent?: CronRunRow[];
  now?: Date;
}

const HOUR = 3_600_000;

export function jobHealth(input: HealthInput): JobHealth {
  const { spec, last, lastOk, recent = [], now = new Date() } = input;
  const slack = spec.slackHours ?? 6;
  const maxRunMs = (spec.maxRunMinutes ?? 10) * 60_000;

  const hoursSinceSuccess = lastOk
    ? (now.getTime() - new Date(lastOk.startedAt).getTime()) / HOUR
    : null;

  // A job that has only ever succeeded on demand is not a working schedule,
  // however green its last run looks.
  const successes = recent.filter(r => r.ok);
  const scheduleSuspect = successes.length > 0 && successes.every(r => r.trigger === 'manual');

  const base = { job: spec.job, label: spec.label, hoursSinceSuccess, last, lastOk, scheduleSuspect };

  if (!last) return { ...base, status: 'never', scheduleSuspect: false };

  if (last.finishedAt === null) {
    const age = now.getTime() - new Date(last.startedAt).getTime();
    return { ...base, status: age > maxRunMs ? 'stuck' : 'running' };
  }

  if (last.ok === false) return { ...base, status: 'failing' };

  if (hoursSinceSuccess === null) return { ...base, status: 'never' };
  return { ...base, status: hoursSinceSuccess > spec.everyHours + slack ? 'stale' : 'ok' };
}

/** The jobs in vercel.json, with the cadence each one is scheduled at. */
export const JOB_SPECS: JobSpec[] = [
  {
    job: 'snapshot',
    label: '狀態快照',
    everyHours: 24,
    // The derive takes about 40s against REDCap; anything past 10 minutes is
    // a run that died rather than a slow one.
    maxRunMinutes: 10,
  },
  { job: 'watchdog', label: '系統守望', everyHours: 24, maxRunMinutes: 5 },
];
