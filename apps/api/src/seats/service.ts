import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import * as seatsRepo from './repository.js';
import * as redisHold from './redisHold.js';

const MAX_HOLD_RETRIES = 3;

function buildSeatGrid(rows: seatsRepo.SeatMapRow[]) {
  if (rows.length === 0) {
    return null;
  }

  const rowCount = rows[0]!.row_count;
  const colCount = rows[0]!.col_count;
  const priceCents = rows[0]!.price_cents;
  const grid: { seatId: number; label: string; status: 'available' | 'held' | 'reserved' }[][] =
    [];

  let index = 0;
  for (let row = 0; row < rowCount; row += 1) {
    const rowCells: { seatId: number; label: string; status: 'available' | 'held' | 'reserved' }[] =
      [];
    for (let col = 0; col < colCount; col += 1) {
      const seat = rows[index];
      if (!seat) {
        throw new AppError('Seat map data is incomplete', 500, 'INTERNAL_ERROR', false);
      }
      rowCells.push({
        seatId: seat.seat_id,
        label: seat.label,
        status: seat.status,
      });
      index += 1;
    }
    grid.push(rowCells);
  }

  return { rowCount, colCount, priceCents, grid };
}

function mapHeldSeats(seats: seatsRepo.HeldSeatRow[]) {
  return seats.map((seat) => ({
    seatId: seat.seat_id,
    label: seat.label,
  }));
}

function assertActiveHold(hold: seatsRepo.HoldRecord, userId: string): void {
  if (hold.userId !== userId) {
    throw new AppError('Hold does not belong to this user', 403, 'FORBIDDEN');
  }
  if (hold.releasedAt !== null) {
    throw new AppError('Hold is no longer active', 409, 'CONFLICT');
  }
  if (hold.expiresAt.getTime() <= Date.now()) {
    throw new AppError('Hold has expired', 409, 'CONFLICT');
  }
}

/**
 * Business logic for seat maps and concurrent seat holds.
 */
export function createSeatsService(env: Env) {
  async function getSeatMap(showtimeId: string) {
    const rows = await seatsRepo.findSeatMapRows(showtimeId);
    if (rows.length === 0) {
      const status = await seatsRepo.findShowtimeStatus(showtimeId);
      if (!status) {
        throw new AppError('Showtime not found', 404, 'NOT_FOUND');
      }
      throw new AppError('Seat map not found', 404, 'NOT_FOUND');
    }

    const built = buildSeatGrid(rows);
    if (!built) {
      throw new AppError('Seat map not found', 404, 'NOT_FOUND');
    }

    return {
      showtimeId,
      priceCents: built.priceCents,
      rows: built.rowCount,
      cols: built.colCount,
      seats: built.grid,
    };
  }

  async function holdSeats(userId: string, input: { showtimeId: string; seatIds: number[] }) {
    const uniqueSeatIds = [...new Set(input.seatIds)];
    if (uniqueSeatIds.length !== input.seatIds.length) {
      throw new AppError('Duplicate seat IDs are not allowed', 400, 'VALIDATION_ERROR');
    }

    const showtimeStatus = await seatsRepo.findShowtimeStatus(input.showtimeId);
    if (!showtimeStatus) {
      throw new AppError('Showtime not found', 404, 'NOT_FOUND');
    }
    if (showtimeStatus !== 'scheduled') {
      throw new AppError('Showtime is not available for booking', 409, 'CONFLICT');
    }

    const holdId = randomUUID();
    const expiresAt = new Date(Date.now() + env.HOLD_TTL_SECONDS * 1000);

    const acquired = await redisHold.tryAcquireSeats(
      input.showtimeId,
      uniqueSeatIds,
      userId,
      env.HOLD_TTL_SECONDS,
    );
    if (!acquired) {
      throw new AppError('One or more seats are unavailable', 409, 'SEATS_UNAVAILABLE');
    }

    try {
      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_HOLD_RETRIES; attempt += 1) {
        try {
          await seatsRepo.callHoldSeats({
            holdId,
            userId,
            showtimeId: input.showtimeId,
            seatIds: uniqueSeatIds,
            expiresAt,
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (!seatsRepo.isSeatsUnavailableError(error)) {
            throw error;
          }
        }
      }

      if (lastError) {
        throw new AppError('One or more seats are unavailable', 409, 'SEATS_UNAVAILABLE');
      }
    } catch (error) {
      await redisHold.releaseSeats(input.showtimeId, uniqueSeatIds);
      if (error instanceof AppError) {
        throw error;
      }
      if (seatsRepo.isSeatsUnavailableError(error)) {
        throw new AppError('One or more seats are unavailable', 409, 'SEATS_UNAVAILABLE');
      }
      throw error;
    }

    const heldSeats = await seatsRepo.findHeldSeatsByHoldId(holdId);

    return {
      holdToken: holdId,
      expiresAt: expiresAt.toISOString(),
      seats: mapHeldSeats(heldSeats),
    };
  }

  async function getHoldStatus(userId: string, holdToken: string) {
    const hold = await seatsRepo.findHoldById(holdToken);
    if (!hold) {
      throw new AppError('Hold not found', 404, 'NOT_FOUND');
    }

    assertActiveHold(hold, userId);

    const seats = await seatsRepo.findHeldSeatsByHoldId(holdToken);

    return {
      holdToken: hold.id,
      showtimeId: hold.showtimeId,
      expiresAt: hold.expiresAt.toISOString(),
      seats: mapHeldSeats(seats),
    };
  }

  async function releaseHold(userId: string, holdToken: string) {
    const hold = await seatsRepo.findHoldById(holdToken);
    if (!hold) {
      throw new AppError('Hold not found', 404, 'NOT_FOUND');
    }
    if (hold.userId !== userId) {
      throw new AppError('Hold does not belong to this user', 403, 'FORBIDDEN');
    }

    const seatIds = await seatsRepo.findSeatIdsByHoldId(holdToken);

    try {
      await seatsRepo.callReleaseHold(holdToken, userId);
    } catch (error) {
      if (seatsRepo.isHoldNotFoundError(error)) {
        throw new AppError('Hold is no longer active', 409, 'CONFLICT');
      }
      throw error;
    }

    await redisHold.releaseSeats(hold.showtimeId, seatIds);
  }

  async function expireStaleHolds() {
    const expiredHolds = await seatsRepo.findExpiredHolds();
    let released = 0;

    for (const hold of expiredHolds) {
      const seatIds = await seatsRepo.callExpireHold(hold.id);
      if (seatIds.length > 0) {
        await redisHold.releaseSeats(hold.showtime_id, seatIds);
        released += 1;
      }
    }

    return released;
  }

  return {
    getSeatMap,
    holdSeats,
    getHoldStatus,
    releaseHold,
    expireStaleHolds,
  };
}
