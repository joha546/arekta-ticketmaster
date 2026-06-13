import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';

let client: Redis | null = null;

export function initRedis(env: Env): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return client;
}

export function getRedis(): Redis {
  if (!client) {
    throw new Error('Redis client not initialized');
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

export function resetRedisForTests(): void {
  client = null;
}
