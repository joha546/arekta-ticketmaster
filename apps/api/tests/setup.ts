import { vi } from 'vitest';

vi.mock('../src/db/pools.js', () => ({
  checkDatabaseHealth: vi.fn().mockResolvedValue({
    primary: true,
    replicaCount: 2,
  }),
  closePools: vi.fn().mockResolvedValue(undefined),
  queryRead: vi.fn(),
  queryWrite: vi.fn(),
}));

vi.mock('../src/instrumentation.js', () => ({
  initInstrumentation: vi.fn(),
  getErrorCounter: vi.fn().mockReturnValue({
    add: vi.fn(),
  }),
}));
