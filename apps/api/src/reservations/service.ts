import type { Env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import * as seatsRepo from '../seats/repository.js';
import * as redisHold from '../seats/redisHold.js';
import { generateReferenceCode } from './referenceCode.js';
import * as reservationsRepo from './repository.js';
import type { ReservationRecord } from './repository.js';

function toApiReservation(
  reservation: ReservationRecord,
  seats: { label: string }[],
  options?: { includeShowtimeId?: boolean },
) {
  const payload = {
    id: reservation.id,
    referenceCode: reservation.referenceCode,
    status: reservation.status,
    totalAmountCents: reservation.totalAmountCents,
    currency: reservation.currency,
    expiresAt: reservation.expiresAt?.toISOString() ?? null,
    seats: seats.map((seat) => ({ label: seat.label })),
  };

  if (options?.includeShowtimeId) {
    return { ...payload, showtimeId: reservation.showtimeId };
  }

  return payload;
}

function toApiListItem(reservation: ReservationRecord) {
  return {
    id: reservation.id,
    referenceCode: reservation.referenceCode,
    status: reservation.status,
    totalAmountCents: reservation.totalAmountCents,
    currency: reservation.currency,
    expiresAt: reservation.expiresAt?.toISOString() ?? null,
    showtimeId: reservation.showtimeId,
    createdAt: reservation.createdAt.toISOString(),
  };
}

/**
 * Business logic for reservations: create from holds, list, detail, cancel, expiry.
 */
export function createReservationsService(env: Env) {
  async function loadReservationWithSeats(
    reservationId: string,
    options?: { includeShowtimeId?: boolean; fromPrimary?: boolean },
  ) {
    const reservation = options?.fromPrimary
      ? await reservationsRepo.findByIdFromPrimary(reservationId)
      : await reservationsRepo.findById(reservationId);
    if (!reservation) {
      throw new AppError('Reservation not found', 404, 'NOT_FOUND');
    }

    const seats = options?.fromPrimary
      ? await reservationsRepo.findSeatsByReservationIdFromPrimary(reservationId)
      : await reservationsRepo.findSeatsByReservationId(reservationId);
    return toApiReservation(reservation, seats, options);
  }

  async function createReservation(
    userId: string,
    input: { holdToken: string; idempotencyKey: string },
  ) {
    const existing = await reservationsRepo.findByIdempotencyKeyFromPrimary(
      userId,
      input.idempotencyKey,
    );
    if (existing) {
      const reservation = await loadReservationWithSeats(existing.id, { fromPrimary: true });
      return { reservation, paymentUrl: null };
    }

    const hold = await seatsRepo.findHoldById(input.holdToken);
    if (!hold) {
      throw new AppError('Hold not found', 404, 'NOT_FOUND');
    }
    if (hold.userId !== userId) {
      throw new AppError('Hold does not belong to this user', 403, 'FORBIDDEN');
    }
    if (hold.releasedAt !== null || hold.expiresAt.getTime() <= Date.now()) {
      throw new AppError('Hold has expired', 409, 'HOLD_EXPIRED');
    }

    const expiresAt = new Date(Date.now() + env.RESERVATION_TTL_SECONDS * 1000);
    const referenceCode = generateReferenceCode();

    try {
      const reservationId = await reservationsRepo.callCreateReservation({
        holdId: input.holdToken,
        userId,
        idempotencyKey: input.idempotencyKey,
        referenceCode,
        expiresAt,
      });

      const reservation = await loadReservationWithSeats(reservationId, { fromPrimary: true });
      return { reservation, paymentUrl: null };
    } catch (error) {
      if (reservationsRepo.isHoldExpiredError(error)) {
        throw new AppError('Hold has expired', 409, 'HOLD_EXPIRED');
      }
      if (reservationsRepo.isHoldConsumedError(error)) {
        throw new AppError('Hold has already been used for a reservation', 409, 'HOLD_CONSUMED');
      }
      if (reservationsRepo.isHoldForbiddenError(error)) {
        throw new AppError('Hold does not belong to this user', 403, 'FORBIDDEN');
      }
      if (reservationsRepo.isHoldNotFoundError(error)) {
        throw new AppError('Hold not found', 404, 'NOT_FOUND');
      }
      throw error;
    }
  }

  async function listReservations(
    user: { id: string; role: 'admin' | 'user' },
    filters: {
      status?: string;
      from?: string;
      to?: string;
      userId?: string;
      movieId?: string;
      page: number;
      limit: number;
    },
  ) {
    const scopedUserId = user.role === 'admin' ? filters.userId : user.id;

    const result = await reservationsRepo.listReservations({
      userId: scopedUserId,
      status: filters.status,
      from: filters.from,
      to: filters.to,
      movieId: user.role === 'admin' ? filters.movieId : undefined,
      page: filters.page,
      limit: filters.limit,
    });

    return {
      items: result.items.map(toApiListItem),
      total: result.total,
      page: filters.page,
      limit: filters.limit,
    };
  }

  async function getReservation(
    user: { id: string; role: 'admin' | 'user' },
    reservationId: string,
  ) {
    const reservation = await reservationsRepo.findById(reservationId);
    if (!reservation) {
      throw new AppError('Reservation not found', 404, 'NOT_FOUND');
    }
    if (reservation.userId !== user.id && user.role !== 'admin') {
      throw new AppError('Access denied', 403, 'FORBIDDEN');
    }

    const seats = await reservationsRepo.findSeatsByReservationId(reservationId);
    return { reservation: toApiReservation(reservation, seats, { includeShowtimeId: true }) };
  }

  async function cancelReservation(userId: string, reservationId: string) {
    try {
      const seatIds = await reservationsRepo.callCancelReservation(reservationId, userId);
      const reservation = await reservationsRepo.findById(reservationId);
      if (reservation && seatIds.length > 0) {
        await redisHold.releaseSeats(reservation.showtimeId, seatIds);
      }
      return { success: true as const };
    } catch (error) {
      if (reservationsRepo.isReservationNotFoundError(error)) {
        throw new AppError('Reservation not found', 404, 'NOT_FOUND');
      }
      if (reservationsRepo.isReservationForbiddenError(error)) {
        throw new AppError('Access denied', 403, 'FORBIDDEN');
      }
      if (reservationsRepo.isNotCancellableError(error)) {
        throw new AppError('Reservation cannot be cancelled', 400, 'NOT_CANCELLABLE');
      }
      throw error;
    }
  }

  async function expireStaleReservations() {
    const batches = await reservationsRepo.callExpirePendingReservations();
    let expired = 0;

    for (const batch of batches) {
      if (batch.seatIds.length > 0) {
        await redisHold.releaseSeats(batch.showtimeId, batch.seatIds);
        expired += 1;
      }
    }

    return expired;
  }

  return {
    createReservation,
    listReservations,
    getReservation,
    cancelReservation,
    expireStaleReservations,
  };
}
