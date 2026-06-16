import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env.js';
import { initPools, queryWrite } from './pools.js';

loadDotenv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  await queryWrite(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await queryWrite<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  return new Set(result.rows.map((row) => row.filename));
}

function getMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

async function applyMigration(filename: string) {
  const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
  await queryWrite(sql);
  await queryWrite('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
  console.log(`Applied migration: ${filename}`);
}

async function migrate() {
  const env = loadEnv({ requireJwt: false });
  initPools(env);

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const files = getMigrationFiles();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping already applied: ${file}`);
      continue;
    }
    await applyMigration(file);
  }

  console.log('Migrations complete');
  process.exit(0);
}

migrate().catch((error) => {
  console.error('Migration failed', error);
  process.exit(1);
});
