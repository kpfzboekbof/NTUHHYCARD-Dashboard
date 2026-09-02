import { randomUUID } from 'node:crypto';
import { getSql, hasDatabase } from './client';

/**
 * The scheduled-job ledger (migration 0004): what ran, when, and how it ended.
 *
 * Written before the work and completed after, so a run the platform kills at
 * its function timeout leaves `finishedAt` null rather than nothing at all.
 * That gap is the whole value: "started and never came back" and "never fired"
 * are different faults with different fixes, and without this row they look
 * identical from the outside.
 */

export type CronTrigger = 'schedule' | 'manual';

export interface CronRunRow {
  id: string;
  job: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  trigger: CronTrigger;
  actor: string | null;
  actorName: string | null;
  result: unknown;
  error: string | null;
  /** Wall time when the run reported an ending; null while it has not. */
  tookMs: number | null;
}

export interface StartCronRunInput {
  job: string;
  trigger: CronTrigger;
  actor: string | null;
}

/** Opens the row. Returns null when there is no database — never throws. */
export async function startCronRun(input: StartCronRunInput): Promise<string | null> {
  if (!hasDatabase()) return null;
  const id = randomUUID();
  const sql = getSql();
  await sql.query(
    `INSERT INTO cron_run (id, job, trigger, actor) VALUES ($1, $2, $3, $4)`,
    [id, input.job, input.trigger, input.actor],
  );
  return id;
}

export async function finishCronRun(id: string | null, result: unknown): Promise<void> {
  if (!hasDatabase() || id === null) return;
  const sql = getSql();
  await sql.query(
    `UPDATE cron_run SET finished_at = now(), ok = true, result = $2 WHERE id = $1`,
    [id, JSON.stringify(result ?? null)],
  );
}

export async function failCronRun(id: string | null, error: string): Promise<void> {
  if (!hasDatabase() || id === null) return;
  const sql = getSql();
  await sql.query(
    `UPDATE cron_run SET finished_at = now(), ok = false, error = $2 WHERE id = $1`,
    [id, error.slice(0, 2000)],
  );
}

function toRow(row: Record<string, unknown>): CronRunRow {
  const startedAt = new Date(row.started_at as string);
  const finishedAt = row.finished_at ? new Date(row.finished_at as string) : null;
  return {
    id: String(row.id),
    job: row.job as string,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt ? finishedAt.toISOString() : null,
    ok: (row.ok as boolean) ?? null,
    trigger: row.trigger as CronTrigger,
    actor: (row.actor as string) ?? null,
    actorName: (row.actor_name as string) ?? null,
    result: row.result,
    error: (row.error as string) ?? null,
    tookMs: finishedAt ? finishedAt.getTime() - startedAt.getTime() : null,
  };
}

const COLUMNS = `r.id, r.job, r.started_at, r.finished_at, r.ok, r.trigger,
                 r.actor, r.result, r.error, p.display_name AS actor_name`;

export async function listCronRuns(job?: string, limit = 50): Promise<CronRunRow[]> {
  if (!hasDatabase()) return [];
  const sql = getSql();
  const rows = await sql.query(
    `SELECT ${COLUMNS}
       FROM cron_run r
       LEFT JOIN person p ON p.id = r.actor
      WHERE ($1::text IS NULL OR r.job = $1)
      ORDER BY r.started_at DESC
      LIMIT $2`,
    [job ?? null, Math.min(limit, 500)],
  );
  return (rows as Record<string, unknown>[]).map(toRow);
}

/**
 * The most recent run of each job, and the most recent one that actually
 * succeeded.
 *
 * Both are needed to say anything useful: the latest run answers "did it try",
 * and the latest success answers "when was this last true" — a job failing
 * every night for a week has a very recent run and a very old success, and
 * showing only one of them tells the wrong story either way.
 */
export async function latestCronRuns(): Promise<Map<string, { last: CronRunRow; lastOk: CronRunRow | null }>> {
  if (!hasDatabase()) return new Map();
  const sql = getSql();
  const rows = await sql.query(
    `WITH ranked AS (
       SELECT ${COLUMNS},
              row_number() OVER (PARTITION BY r.job ORDER BY r.started_at DESC) AS rn_all,
              row_number() OVER (PARTITION BY r.job, r.ok ORDER BY r.started_at DESC) AS rn_by_ok
         FROM cron_run r
         LEFT JOIN person p ON p.id = r.actor
     )
     SELECT * FROM ranked WHERE rn_all = 1 OR (ok IS TRUE AND rn_by_ok = 1)`,
    [],
  );

  const byJob = new Map<string, { last: CronRunRow; lastOk: CronRunRow | null }>();
  for (const raw of rows as Record<string, unknown>[]) {
    const row = toRow(raw);
    const entry = byJob.get(row.job);
    if (!entry) {
      byJob.set(row.job, { last: row, lastOk: row.ok ? row : null });
      continue;
    }
    if (new Date(row.startedAt) > new Date(entry.last.startedAt)) entry.last = row;
    if (row.ok && (!entry.lastOk || new Date(row.startedAt) > new Date(entry.lastOk.startedAt))) {
      entry.lastOk = row;
    }
  }
  return byJob;
}
