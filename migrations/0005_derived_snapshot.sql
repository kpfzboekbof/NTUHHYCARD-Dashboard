-- The derived views: where their last build is, and who is rebuilding them.
--
-- Every heavy page is a view derived from a REDCap export that takes between
-- ten seconds and a minute. Those views lived in a cache that forgot them
-- after five minutes, so with one operator nearly every visit after a short
-- pause paid the full export again, in the foreground, while the page showed
-- a spinner.
--
-- Now the last good build of each view is kept for as long as it takes to
-- build the next one. A request is answered from it at once, and if it is
-- older than the view's freshness window the rebuild runs behind the response
-- rather than in front of it. Nothing here is the source of anything — REDCap
-- is — so losing a row costs exactly one foreground rebuild.
--
-- This table holds only the bookkeeping. The build itself — which for the
-- etiology and log views includes chart numbers and field values — is written
-- gzipped to Vercel Blob beside the diff baseline, where derived clinical data
-- already lives; this database stays management metadata only, as README
-- promises.

CREATE TABLE IF NOT EXISTS derived_snapshot (
  key                 text PRIMARY KEY,
  -- When the export behind the stored build BEGAN, not when it finished:
  -- that is the age of the data, and what an invalidation is compared
  -- against. NULL until the first build lands; a row can exist before that
  -- because the refresh lock lives here too.
  fetched_at          timestamptz,
  -- Where the gzipped build is, and how big.
  blob_path           text,
  bytes               integer,
  -- A write elsewhere (etiology_final, a QC fix, a settings change) made the
  -- build suspect. Non-null means "not yet absorbed by a build": a build that
  -- began after the write clears it, one that was already running when the
  -- write landed leaves it, because its export may predate the write.
  invalidated_at      timestamptz,
  -- The refresh lease: set when a rebuild claims the view, cleared when the
  -- build lands or the lease runs out. Two instances answering at the same
  -- moment would otherwise both run the same minute-long export.
  refresh_started_at  timestamptz,
  -- Background rebuilds claimed since the last one landed. A rebuild the
  -- platform kills at its time limit leaves no other trace; after a few of
  -- those the view stops trying in the background and says so, instead of
  -- reporting "updating" for ever.
  refresh_attempts    integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One row (key '__redcap_export__') doubles as the lock on REDCap itself: at
-- most one background export in flight across every view. The server has
-- been measured falling from a one-minute export to ten when two run side by
-- side.
