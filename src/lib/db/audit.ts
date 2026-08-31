import { getSql } from './client';

/**
 * The audit trail.
 *
 * Nothing recorded who changed what: assignments overwrote a single blob with
 * no history, screening decisions stored only {decision, reviewedAt}, and every
 * REDCap write-back went out under one shared token. "Who set etiology_final on
 * this record, and when" had no answer. Every mutating route now writes one row
 * here, in the same transaction as the change itself, so the record cannot
 * exist without its audit entry.
 */

/** A person acting through the UI, or a machine token (scraper, cron, PA report). */
export type Actor =
  | { personId: string }
  | { tokenName: string };

export interface AuditEntry {
  actor: Actor;
  /** Dotted verb, e.g. 'assignment_rule.create', 'etiology_final.write'. */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

type SqlTag = ReturnType<typeof getSql>;

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/**
 * The INSERT for an audit entry, unawaited, so a caller can pass it to
 * `sql.transaction([...])` alongside the change it describes.
 */
export function auditQuery(sql: SqlTag, entry: AuditEntry) {
  const personId = 'personId' in entry.actor ? entry.actor.personId : null;
  const tokenName = 'tokenName' in entry.actor ? entry.actor.tokenName : null;

  return sql`
    INSERT INTO audit_log (actor_person_id, actor_token_name, action, entity_type, entity_id, before, after)
    VALUES (${personId}, ${tokenName}, ${entry.action}, ${entry.entityType}, ${entry.entityId},
            ${toJson(entry.before)}, ${toJson(entry.after)})
  `;
}

/** Write one audit row on its own, for changes that are not database writes. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  await auditQuery(getSql(), entry);
}

export interface AuditRow {
  id: string;
  ts: string;
  actorPersonId: string | null;
  actorName: string | null;
  actorTokenName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

export interface AuditFilter {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorPersonId?: string;
  limit?: number;
}

export async function listAudit(filter: AuditFilter = {}): Promise<AuditRow[]> {
  const limit = Math.min(filter.limit ?? 100, 500);
  const sql = getSql();

  // Nulls stand for "no filter" so this stays one prepared statement rather
  // than string-built SQL.
  const rows = await sql`
    SELECT a.id, a.ts, a.actor_person_id, a.actor_token_name, a.action,
           a.entity_type, a.entity_id, a.before, a.after, p.display_name
    FROM audit_log a
    LEFT JOIN person p ON p.id = a.actor_person_id
    WHERE (${filter.action ?? null}::text IS NULL OR a.action = ${filter.action ?? null})
      AND (${filter.entityType ?? null}::text IS NULL OR a.entity_type = ${filter.entityType ?? null})
      AND (${filter.entityId ?? null}::text IS NULL OR a.entity_id = ${filter.entityId ?? null})
      AND (${filter.actorPersonId ?? null}::uuid IS NULL OR a.actor_person_id = ${filter.actorPersonId ?? null})
    ORDER BY a.ts DESC
    LIMIT ${limit}
  `;

  return rows.map(row => ({
    id: String(row.id),
    ts: new Date(row.ts).toISOString(),
    actorPersonId: row.actor_person_id,
    actorName: row.display_name ?? null,
    actorTokenName: row.actor_token_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    before: row.before,
    after: row.after,
  }));
}
