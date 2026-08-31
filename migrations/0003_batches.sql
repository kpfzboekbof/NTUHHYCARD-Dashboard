-- A batch: "everything up to study id N should be done by date D".
--
-- This is the registry lead's actual unit of planning, and until now it existed
-- only as two anonymous integers in a Redis blob (targetIds.basic / .exam) with
-- no date, no name and no history. A batch has a deadline, so "how far behind
-- is this person" finally has a denominator that means something, and the
-- reminder mail has something to be about.
--
-- The clinical data stays in REDCap; this table holds only the intent.

CREATE TABLE IF NOT EXISTS batch (
  id               uuid PRIMARY KEY,
  name             text NOT NULL,
  -- Records with study_id at or below this are in scope. Study ids are
  -- numeric strings in REDCap; compared numerically by the application.
  study_id_cutoff  integer NOT NULL,
  due_date         date,
  -- Which work units this batch is about. Empty means every visible unit, so
  -- a batch can be created with nothing but an id cutoff and a date.
  unit_ids         text[] NOT NULL DEFAULT '{}',
  created_by       uuid REFERENCES person,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Set when the lead declares the batch finished; closed batches stay for the
  -- record rather than being deleted.
  closed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS batch_open_idx ON batch (due_date) WHERE closed_at IS NULL;
