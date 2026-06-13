import { Pool, type QueryResultRow } from 'pg';
import type { Env } from '../config/env.js';

let writePool: Pool | null = null;
let readPools: Pool[] = [];
let readIndex = 0;

export function initPools(env: Env) {
  if (writePool) {
    return;
  }

  writePool = new Pool({ connectionString: env.DATABASE_PRIMARY_URL });
  readPools = [
    new Pool({ connectionString: env.DATABASE_REPLICA_1_URL }),
    new Pool({ connectionString: env.DATABASE_REPLICA_2_URL }),
  ];
}

function getWritePool(): Pool {
  if (!writePool) {
    throw new Error('Database pools not initialized');
  }
  return writePool;
}

function getReadPool(): Pool {
  if (readPools.length === 0) {
    throw new Error('Database pools not initialized');
  }
  const pool = readPools[readIndex % readPools.length];
  readIndex += 1;
  return pool;
}

export async function queryWrite<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getWritePool().query<T>(text, params);
}

export async function queryRead<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getReadPool().query<T>(text, params);
}

export async function checkDatabaseHealth() {
  let primary = false;
  let replicaCount = 0;

  try {
    await getWritePool().query('SELECT 1');
    primary = true;
  } catch {
    primary = false;
  }

  for (const pool of readPools) {
    try {
      const result = await pool.query<{ in_recovery: boolean }>(
        'SELECT pg_is_in_recovery() AS in_recovery',
      );
      if (result.rows[0]?.in_recovery) {
        replicaCount += 1;
      }
    } catch {
      // replica unavailable
    }
  }

  return { primary, replicaCount };
}

export async function closePools() {
  await writePool?.end();
  await Promise.all(readPools.map((pool) => pool.end()));
  writePool = null;
  readPools = [];
  readIndex = 0;
}

export function resetPoolsForTests() {
  writePool = null;
  readPools = [];
  readIndex = 0;
}
