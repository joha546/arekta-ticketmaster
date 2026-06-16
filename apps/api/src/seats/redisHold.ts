import { getRedis } from '../redis/client.js';

const HOLD_KEY_PREFIX = 'seat_hold';

export function seatHoldKey(showtimeId: string, seatId: number): string {
  return `${HOLD_KEY_PREFIX}:${showtimeId}:${seatId}`;
}

const BATCH_HOLD_LUA = `
local userId = ARGV[1]
local ttl = tonumber(ARGV[2])
for i = 1, #KEYS do
  if redis.call('SETNX', KEYS[i], userId) == 0 then
    for j = 1, i - 1 do
      redis.call('DEL', KEYS[j])
    end
    return 0
  end
end
for i = 1, #KEYS do
  redis.call('EXPIRE', KEYS[i], ttl)
end
return 1
`;

/**
 * Layer 1 — Redis batch SETNX with Lua rollback on partial failure.
 */
export async function tryAcquireSeats(
  showtimeId: string,
  seatIds: number[],
  userId: string,
  ttlSeconds: number,
): Promise<boolean> {
  if (seatIds.length === 0) {
    return false;
  }

  const redis = getRedis();
  const keys = seatIds.map((seatId) => seatHoldKey(showtimeId, seatId));
  const result = await redis.eval(BATCH_HOLD_LUA, keys.length, ...keys, userId, String(ttlSeconds));
  return Number(result) === 1;
}

export async function releaseSeats(showtimeId: string, seatIds: number[]): Promise<void> {
  if (seatIds.length === 0) {
    return;
  }

  const redis = getRedis();
  const keys = seatIds.map((seatId) => seatHoldKey(showtimeId, seatId));
  await redis.del(...keys);
}
