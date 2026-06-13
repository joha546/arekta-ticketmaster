import { vi } from 'vitest';
import './helpers/jwt.js';

const mockRedis = {
  incr: vi.fn().mockResolvedValue(1),
  quit: vi.fn().mockResolvedValue('OK'),
};

vi.mock('../src/db/pools.js', () => ({
  checkDatabaseHealth: vi.fn().mockResolvedValue({
    primary: true,
    replicaCount: 2,
  }),
  closePools: vi.fn().mockResolvedValue(undefined),
  queryRead: vi.fn(),
  queryWrite: vi.fn(),
}));

vi.mock('../src/redis/client.js', () => ({
  initRedis: vi.fn().mockReturnValue(mockRedis),
  getRedis: vi.fn().mockReturnValue(mockRedis),
  closeRedis: vi.fn().mockResolvedValue(undefined),
  resetRedisForTests: vi.fn(),
}));

vi.mock('../src/instrumentation.js', () => ({
  initInstrumentation: vi.fn(),
  getErrorCounter: vi.fn().mockReturnValue({
    add: vi.fn(),
  }),
}));
