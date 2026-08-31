-- Phase 1: who people are, and what they changed.
--
-- Three identity systems existed side by side: REDCap usernames, the etiology
-- labeler dropdown codes (0/3/5/6/7), and a web tier with no individual identity
-- at all — two shared passwords. Everything downstream joined on display-name
-- strings, so a rename or a duplicate name silently misattributed work. One
-- person row now carries all three, and every join keys on its id.

CREATE TABLE IF NOT EXISTS person (
  id                uuid PRIMARY KEY,
  -- Any of the three identifiers may be absent: a labeler need not have a
  -- REDCap account, and a REDCap account need not do etiology review.
  redcap_username   text UNIQUE,
  labeler_code      smallint UNIQUE,
  display_name      text NOT NULL,
  email             text UNIQUE NOT NULL,
  roles             text[] NOT NULL DEFAULT '{viewer}',
  -- Replaces excluding one person from group emails by hardcoded name string.
  broadcast_opt_out boolean NOT NULL DEFAULT false,
  notify_pref       text NOT NULL DEFAULT 'digest',
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Email is the login identifier, so match it case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS person_email_lower_idx ON person (lower(email));

CREATE TABLE IF NOT EXISTS audit_log (
  id               bigserial PRIMARY KEY,
  ts               timestamptz NOT NULL DEFAULT now(),
  -- Exactly one of these identifies the actor: a person, or a machine token
  -- (the scraper, the weekly report routine, a cron run).
  actor_person_id  uuid REFERENCES person(id),
  actor_token_name text,
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        text NOT NULL,
  before           jsonb,
  after            jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_person_id, ts DESC);

-- Magic-link login. A signed token alone cannot be single-use: without a
-- record of what has been redeemed, the link in an inbox stays replayable for
-- its whole validity window.
CREATE TABLE IF NOT EXISTS login_token (
  jti        uuid PRIMARY KEY,
  person_id  uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_token_expiry_idx ON login_token (expires_at);
