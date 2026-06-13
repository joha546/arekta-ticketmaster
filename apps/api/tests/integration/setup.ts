import { afterAll, beforeAll } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { closePools, initPools } from '../../src/db/pools.js';

/**
 * Integration test bootstrap — connects to the real PostgreSQL primary.
 * Unit tests use mocked pools via tests/setup.ts; this file runs only in the
 * integration Vitest project (see vitest.config.ts).
 *
 * Set INTEGRATION_TEST=0 to skip integration specs (e.g. CI without a database).
 */
export const skipIntegration = process.env.INTEGRATION_TEST === '0';

beforeAll(async () => {
  if (skipIntegration) {
    return;
  }

  const env = loadEnv();
  // Host-side integration runs often lack replica ports; use primary for reads
  // so seed verification does not depend on replica healthchecks.
  initPools({
    ...env,
    DATABASE_REPLICA_1_URL: env.DATABASE_PRIMARY_URL,
    DATABASE_REPLICA_2_URL: env.DATABASE_PRIMARY_URL,
  });
});

afterAll(async () => {
  if (skipIntegration) {
    return;
  }

  await closePools();
});
