-- Every run of a scheduled job, whether it finished or not.
--
-- A cron job runs with nobody watching: success is silent and so is failure.
-- Until now the only trace was Vercel's log, which expires and lives outside
-- the dashboard, so "has the snapshot been running?" was not a question this
-- system could answer about itself — and a stalled snapshot looks exactly like
-- everybody having stopped work.
--
-- The row is written before the job starts and completed after, the same order
-- as outbound_mail. That is the point rather than a detail: a run killed by the
-- platform's function timeout can never write its own ending, so it leaves
-- started_at with finished_at still NULL — the one shape that distinguishes
-- "died halfway" from "never fired", which are the two diagnoses that matter
-- and were previously indistinguishable.

CREATE TABLE IF NOT EXISTS cron_run (
  id           uuid PRIMARY KEY,
  -- 'snapshot' | 'watchdog'; text rather than an enum so adding a job is a
  -- deploy, not a migration.
  job          text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  -- NULL means the run never reported an ending: still going, or killed.
  finished_at  timestamptz,
  ok           boolean,
  -- 'schedule' (the platform's scheduler, carrying CRON_SECRET) or 'manual'
  -- (a manager pressing the button). Worth separating: a job that only ever
  -- succeeds manually is a job whose schedule is broken.
  trigger      text NOT NULL,
  -- Who pressed it, when we know. NULL for the scheduler, and for a manual run
  -- authorised by the shared password, which names nobody.
  actor        uuid REFERENCES person,
  -- The job's own summary — record counts, events written, alerts raised.
  result       jsonb,
  error        text
);

-- The only two questions asked of this table: the latest run of a job, and
-- that job's recent history.
CREATE INDEX IF NOT EXISTS cron_run_job_started_idx ON cron_run (job, started_at DESC);
