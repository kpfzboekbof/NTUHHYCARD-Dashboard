import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@neondatabase/serverless';

/**
 * Applies the .sql files in ./migrations in name order, once each.
 *
 * Run with `npm run migrate`. Deliberately minimal: this database holds a
 * handful of management tables, and a schema tool would be more machinery than
 * the problem needs.
 *
 * Uses the WebSocket client rather than the HTTP one the app uses: HTTP queries
 * are prepared statements, which cannot carry the multiple statements a
 * migration file contains, and each file is applied inside a transaction.
 */

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 未設定');
  process.exit(1);
}

/**
 * Tables this project owns. Anything else in `public` means DATABASE_URL is
 * pointing at a database that belongs to another application — which is how a
 * run against a live biobank inventory system was caught the first time. Bail
 * out rather than scatter tables into someone else's schema.
 */
const OWNED_TABLES = new Set([
  'schema_migrations',
  'person',
  'audit_log',
  'login_token',
]);

const client = new Client(url);
await client.connect();

try {
  const { rows: existing } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const foreign = existing.map(r => r.table_name).filter(name => !OWNED_TABLES.has(name)).sort();
  if (foreign.length > 0 && process.argv[2] !== '--allow-shared') {
    console.error('拒絕執行：這個資料庫裡有不屬於本專案的資料表');
    console.error(`  ${foreign.join(', ')}`);
    console.error('DATABASE_URL 可能指向別的應用程式的資料庫。');
    console.error('確認無誤要共用，才加上 --allow-shared 重跑。');
    process.exit(1);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map(row => row.name));
  const files = readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();

  let count = 0;
  for (const name of files) {
    if (applied.has(name)) {
      console.log(`· ${name} (already applied)`);
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(readFileSync(migrationsDir + name, 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${name} failed: ${error.message}`, { cause: error });
    }
    console.log(`✓ ${name}`);
    count++;
  }

  console.log(count === 0 ? 'nothing to apply' : `applied ${count} migration(s)`);
} finally {
  await client.end();
}
