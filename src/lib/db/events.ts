import { getSql, hasDatabase } from './client';
import type { WorkEvent } from '@/lib/state/diff';

/**
 * Reading and writing the handoff event stream.
 *
 * Inserts go through one `jsonb_to_recordset` statement whatever the batch
 * size: a day's diff can be a handful of rows or a few thousand after a
 * meeting's batch upload, and neither should cost one round trip per event.
 */

export interface StoredWorkEvent {
  id: string;
  ts: string;
  snapshotTs: string;
  studyId: string;
  unitId: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  cause: unknown;
  routedPersonIds: string[];
}

export async function insertWorkEvents(
  events: WorkEvent[],
  snapshotTs: string,
  routing: Map<string, string[]>,
): Promise<number> {
  if (!hasDatabase() || events.length === 0) return 0;

  const payload = events.map(event => ({
    studyId: event.studyId,
    unitId: event.unitId,
    eventType: event.eventType,
    fromState: event.fromState,
    toState: event.toState,
    cause: event.cause,
    routed: routing.get(event.unitId) ?? [],
  }));

  const sql = getSql();
  await sql.query(
    `INSERT INTO work_event (snapshot_ts, study_id, unit_id, event_type, from_state, to_state, cause, routed_person_ids)
     SELECT $1::timestamptz, e."studyId", e."unitId", e."eventType", e."fromState", e."toState", e.cause,
            COALESCE((SELECT array_agg(x)::uuid[] FROM jsonb_array_elements_text(e.routed) AS x), '{}')
     FROM jsonb_to_recordset($2::jsonb) AS e(
       "studyId" text, "unitId" text, "eventType" text,
       "fromState" text, "toState" text, cause jsonb, routed jsonb
     )`,
    [snapshotTs, JSON.stringify(payload)],
  );
  return events.length;
}

export interface EventFilter {
  eventType?: string;
  unitId?: string;
  studyId?: string;
  /** ISO timestamp; only events at or after it. */
  since?: string;
  limit?: number;
}

export async function listWorkEvents(filter: EventFilter = {}): Promise<StoredWorkEvent[]> {
  if (!hasDatabase()) return [];
  const limit = Math.min(filter.limit ?? 500, 5000);

  const sql = getSql();
  const rows = await sql.query(
    `SELECT id, ts, snapshot_ts, study_id, unit_id, event_type, from_state, to_state, cause, routed_person_ids
       FROM work_event
      WHERE ($1::text IS NULL OR event_type = $1)
        AND ($2::text IS NULL OR unit_id = $2)
        AND ($3::text IS NULL OR study_id = $3)
        AND ($4::timestamptz IS NULL OR ts >= $4)
      ORDER BY ts DESC, id DESC
      LIMIT $5`,
    [filter.eventType ?? null, filter.unitId ?? null, filter.studyId ?? null, filter.since ?? null, limit],
  );

  return (rows as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    ts: new Date(row.ts as string).toISOString(),
    snapshotTs: new Date(row.snapshot_ts as string).toISOString(),
    studyId: row.study_id as string,
    unitId: row.unit_id as string,
    eventType: row.event_type as string,
    fromState: (row.from_state as string) ?? null,
    toState: (row.to_state as string) ?? null,
    cause: row.cause,
    routedPersonIds: (row.routed_person_ids as string[]) ?? [],
  }));
}

/**
 * The freshest handoff per cell: which (studyId, unitId) pairs became ready or
 * awaiting-verify since a cutoff. This is the "new since" facet of the queue —
 * a filter over facts, not an unread count.
 */
export async function recentHandoffKeys(since: string): Promise<Set<string>> {
  if (!hasDatabase()) return new Set();
  const sql = getSql();
  const rows = await sql.query(
    `SELECT DISTINCT study_id, unit_id
       FROM work_event
      WHERE ts >= $1::timestamptz
        AND event_type IN ('became_ready', 'entered_awaiting_verify')`,
    [since],
  );
  return new Set((rows as Record<string, string>[]).map(r => `${r.study_id}|${r.unit_id}`));
}
