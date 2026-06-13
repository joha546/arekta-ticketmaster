import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env.js';
import { initPools, queryWrite } from './pools.js';

loadDotenv();

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const env = loadEnv();
  initPools(env);

  const migrationSql = readFileSync(join(__dirname, 'migrations', '0001_init.sql'), 'utf8');
  await queryWrite(migrationSql);

  console.log('Migration applied successfully');
  process.exit(0);
}

migrate().catch((error) => {
  console.error('Migration failed', error);
  process.exit(1);
});
