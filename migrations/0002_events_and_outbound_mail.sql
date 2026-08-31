-- Phase 4: what changed hands, and what mail actually left.
--
-- work_event is the diff between two state-matrix snapshots made durable: the
-- moment a unit became workable, blocked, or slid back. The queue itself is
-- always re-derived from the latest snapshot — losing an event can never lose
-- work, it only loses the "since when" behind it.
--
-- outbound_mail is the delivery ledger (§7.4). The dashboard has one reader;
-- the people doing the work are reached by email alone, so "how many times was
-- this person chased this month" and "did that reminder actually leave" must
-- be facts, not impressions. The old reminderSentAt was one global timestamp,
-- updated even when every send failed.

CREATE TABLE IF NOT EXISTS work_event (
  id           bigserial PRIMARY KEY,
  ts           timestamptz NOT NULL DEFAULT now(),
  -- When the snapshot that revealed the change was taken. With a daily cadence
  -- the true change happened up to a day earlier; ts is honest about what we
  -- know, snapshot_ts about when we learned it.
  snapshot_ts  timestamptz NOT NULL,
  study_id     text NOT NULL,
  unit_id      text NOT NULL,
  event_type   text NOT NULL,  -- became_ready | became_blocked | entered_awaiting_verify | completed | regressed | became_na | assigned
  from_state   text,
  to_state     text,
  -- For became_ready this is the previous cell's block reason: what it had
  -- been waiting on is exactly the cause of the handoff.
  cause        jsonb,
  routed_person_ids uuid[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS work_event_study_idx ON work_event (study_id);
CREATE INDEX IF NOT EXISTS work_event_unit_ts_idx ON work_event (unit_id, ts);
CREATE INDEX IF NOT EXISTS work_event_type_ts_idx ON work_event (event_type, ts);

CREATE TABLE IF NOT EXISTS outbound_mail (
  id            bigserial PRIMARY KEY,
  to_person_id  uuid REFERENCES person,     -- NULL when the mail goes to the operator themself
  to_email      text NOT NULL,              -- the address as sent; a later email change must not rewrite history
  kind          text NOT NULL,              -- meeting_reminder | nudge | batch_due | scan_missing | snapshot_stale | login_link
  payload       jsonb NOT NULL,
  requested_by  uuid REFERENCES person,     -- who pressed the button; NULL for the watchdog
  sent_at       timestamptz,                -- NULL = the send failed
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbound_mail_person_idx ON outbound_mail (to_person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outbound_mail_kind_idx ON outbound_mail (kind, created_at DESC);
