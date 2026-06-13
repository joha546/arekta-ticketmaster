import { vi } from 'vitest';
import './helpers/jwt.js';

type RedisEntry = {
  value: string;
  expiresAt: number | null;
};

const redisStore = new Map<string, RedisEntry>();

function isExpired(entry: RedisEntry): boolean {
  return entry.expiresAt !== null && entry.expiresAt <= Date.now();
}

function purgeExpired(key: string): void {
  const entry = redisStore.get(key);
  if (entry && isExpired(entry)) {
    redisStore.delete(key);
  }
}

const mockRedis = {
  incr: vi.fn(async (key: string) => {
    purgeExpired(key);
    const entry = redisStore.get(key);
    const next = entry && !isExpired(entry) ? Number(entry.value) + 1 : 1;
    redisStore.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }),
  get: vi.fn(async (key: string) => {
    purgeExpired(key);
    const entry = redisStore.get(key);
    return entry && !isExpired(entry) ? entry.value : null;
  }),
  set: vi.fn(async (key: string, value: string, mode?: string, ttl?: number) => {
    const expiresAt = mode === 'EX' && typeof ttl === 'number' ? Date.now() + ttl * 1000 : null;
    redisStore.set(key, { value, expiresAt });
    return 'OK';
  }),
  del: vi.fn(async (...keys: string[]) => {
    let removed = 0;
    for (const key of keys) {
      if (redisStore.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }),
  expire: vi.fn(async (key: string, ttl: number) => {
    const entry = redisStore.get(key);
    if (!entry) {
      return 0;
    }
    entry.expiresAt = Date.now() + ttl * 1000;
    return 1;
  }),
  quit: vi.fn().mockResolvedValue('OK'),
};

export function resetMockRedisStore(): void {
  redisStore.clear();
  vi.clearAllMocks();
}

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
