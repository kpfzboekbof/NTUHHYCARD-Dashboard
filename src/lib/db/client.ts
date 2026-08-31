import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

/**
 * Postgres access for management metadata.
 *
 * Clinical data stays in REDCap; this database only holds the things REDCap
 * cannot express — who people are, who is assigned to what, and what was
 * changed by whom.
 *
 * Queries go over Neon's HTTP driver rather than a pooled TCP connection: on
 * serverless there is no long-lived process to hold a pool, and every query
 * here is short. Ids are generated in the application (crypto.randomUUID) so a
 * write and its audit row can go out as one non-interactive transaction
 * without a round trip to read back a generated id.
 */

let cached: NeonQueryFunction<false, false> | undefined;

/**
 * Connection string for this project's database.
 *
 * OHCA_DATABASE_URL wins so that a development environment shared with other
 * projects can hold each one's database under its own name — pointing this app
 * at another application's database is exactly the mistake worth making
 * impossible. DATABASE_URL is the fallback because that is the name the
 * Vercel/Neon integration sets in a dedicated deployment.
 */
export function databaseUrl(): string | undefined {
  return process.env.OHCA_DATABASE_URL || process.env.DATABASE_URL;
}

export function getSql(): NeonQueryFunction<false, false> {
  if (cached) return cached;

  const url = databaseUrl();
  if (!url) {
    throw new Error('OHCA_DATABASE_URL / DATABASE_URL 未設定：管理資料庫（人員、稽核）無法使用');
  }
  cached = neon(url);
  return cached;
}

/** True when a management database is configured at all. */
export function hasDatabase(): boolean {
  return !!databaseUrl();
}

export function newId(): string {
  return crypto.randomUUID();
}
