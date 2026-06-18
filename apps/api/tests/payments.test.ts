import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  cancelReservationResponseSchema,
  paymentStatusResponseSchema,
} from '@repo/shared';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { queryRead, queryWrite } from '../src/db/pools.js';
import { createLogger } from '../src/middleware/logger.js';
import { signTestToken } from './helpers/jwt.js';
import {
  mockStripeCheckoutCreate,
  mockStripeConstructEvent,
  mockStripeRefundsCreate,
  resetMockRedisStore,
} from './setup.js';

const SHOWTIME_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MOVIE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333';

const IDEM_CHECKOUT = '11111111-1111-4111-8111-111111111201';
const IDEM_WEBHOOK = '11111111-1111-4111-8111-111111111202';
const IDEM_STATUS = '11111111-1111-4111-8111-111111111203';
const IDEM_REFUND = '11111111-1111-4111-8111-111111111204';
const IDEM_NO_REFUND = '11111111-1111-4111-8111-111111111205';

const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const COLS = 12;

type ShowtimeRow = {
  id: string;
  movie_id: string;
  status: 'scheduled' | 'cancelled' | 'completed';
  price_cents: number;
  screen_id: number;
  start_time: Date;
  end_time: Date;
};

type SeatDefinition = {
  id: number;
  label: string;
  row_label: string;
  col_number: number;
  screen_id: number;
};

type ShowtimeSeatState = {
  id: number;
  showtime_id: string;
  seat_id: number;
  status: 'available' | 'held' | 'reserved';
  version: number;
  hold_id: string | null;
  reservation_id: string | null;
};

type HoldRow = {
  id: string;
  user_id: string;
  showtime_id: string;
  expires_at: Date;
  released_at: Date | null;
};

type ReservationRow = {
  id: string;
  reference_code: string;
  user_id: string;
  showtime_id: string;
  hold_id: string | null;
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled';
  total_amount_cents: number;
  currency: string;
  idempotency_key: string | null;
  expires_at: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
};

type PaymentRow = {
  id: string;
  reservation_id: string;
  provider: string;
  provider_payment_intent_id: string | null;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  amount_cents: number;
  currency: string;
  gateway_response: Record<string, unknown>;
  provider_refund_id: string | null;
  refunded_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type UserRow = {
  id: string;
  email: string;
  email_verified_at: Date | null;
  role: 'admin' | 'user';
};

const showtimes = new Map<string, ShowtimeRow>();
const screenSeats = new Map<number, SeatDefinition>();
const showtimeSeats = new Map<string, ShowtimeSeatState[]>();
const holds = new Map<string, HoldRow>();
const reservations = new Map<string, ReservationRow>();
const reservationSeatLinks = new Map<string, number[]>();
const payments = new Map<string, PaymentRow>();
const webhookEvents = new Set<string>();
const users = new Map<string, UserRow>();

let nextShowtimeSeatId = 1;

const verifiedToken = signTestToken({
  sub: USER_ID,
  email: 'user@arekta.local',
  role: 'user',
});

const otherUserToken = signTestToken({
  sub: OTHER_USER_ID,
  email: 'other@arekta.local',
  role: 'user',
});

const env = loadEnv();
const logger = createLogger({ ...env, LOG_LEVEL: 'silent' });
const app = createApp(env, logger);

function seedScreenSeats(): void {
  screenSeats.clear();
  let seatId = 1;
  for (const rowLabel of ROW_LABELS) {
    for (let col = 1; col <= COLS; col += 1) {
      screenSeats.set(seatId, {
        id: seatId,
        label: `${rowLabel}${col}`,
        row_label: rowLabel,
        col_number: col,
        screen_id: 1,
      });
      seatId += 1;
    }
  }
}

function seedShowtime(): void {
  const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
  showtimes.set(SHOWTIME_ID, {
    id: SHOWTIME_ID,
    movie_id: MOVIE_ID,
    status: 'scheduled',
    price_cents: 1200,
    screen_id: 1,
    start_time: startTime,
    end_time: new Date(startTime.getTime() + 2 * 60 * 60 * 1000),
  });

  showtimeSeats.set(
    SHOWTIME_ID,
    [...screenSeats.values()].map((seat) => ({
      id: nextShowtimeSeatId++,
      showtime_id: SHOWTIME_ID,
      seat_id: seat.id,
      status: 'available' as const,
      version: 0,
      hold_id: null,
      reservation_id: null,
    })),
  );
}

function seedUsers(): void {
  users.set(USER_ID, {
    id: USER_ID,
    email: 'user@arekta.local',
    email_verified_at: new Date(),
    role: 'user',
  });
  users.set(OTHER_USER_ID, {
    id: OTHER_USER_ID,
    email: 'other@arekta.local',
    email_verified_at: new Date(),
    role: 'user',
  });
}

function getShowtimeSeat(showtimeId: string, seatId: number): ShowtimeSeatState | undefined {
  return showtimeSeats.get(showtimeId)?.find((seat) => seat.seat_id === seatId);
}

function simulateHoldSeats(
  holdId: string,
  userId: string,
  showtimeId: string,
  seatIds: number[],
  expiresAt: Date,
): void {
  for (const seatId of seatIds) {
    const seat = getShowtimeSeat(showtimeId, seatId);
    if (!seat || seat.status !== 'available') {
      const error = new Error('seats_unavailable') as Error & { code: string };
      error.code = 'P0001';
      throw error;
    }
  }

  for (const seatId of seatIds) {
    const seat = getShowtimeSeat(showtimeId, seatId);
    if (!seat) {
      continue;
    }
    seat.status = 'held';
    seat.hold_id = holdId;
    seat.version += 1;
  }

  holds.set(holdId, {
    id: holdId,
    user_id: userId,
    showtime_id: showtimeId,
    expires_at: expiresAt,
    released_at: null,
  });
}

function simulateCreateReservation(
  holdId: string,
  userId: string,
  idempotencyKey: string,
  referenceCode: string,
  expiresAt: Date,
): string {
  const hold = holds.get(holdId);
  if (!hold) {
    const error = new Error('hold_not_found') as Error & { code: string };
    error.code = 'P0002';
    throw error;
  }

  const heldSeats = (showtimeSeats.get(hold.showtime_id) ?? []).filter(
    (seat) => seat.hold_id === holdId && seat.status === 'held',
  );
  const showtime = showtimes.get(hold.showtime_id);
  if (!showtime || heldSeats.length === 0) {
    const error = new Error('hold_not_found') as Error & { code: string };
    error.code = 'P0002';
    throw error;
  }

  const reservationId = randomUUID();
  reservations.set(reservationId, {
    id: reservationId,
    reference_code: referenceCode,
    user_id: userId,
    showtime_id: hold.showtime_id,
    hold_id: holdId,
    status: 'pending',
    total_amount_cents: heldSeats.length * showtime.price_cents,
    currency: 'USD',
    idempotency_key: idempotencyKey,
    expires_at: expiresAt,
    confirmed_at: null,
    cancelled_at: null,
    created_at: new Date(),
  });

  reservationSeatLinks.set(
    reservationId,
    heldSeats.map((seat) => seat.id),
  );

  for (const seat of heldSeats) {
    seat.reservation_id = reservationId;
  }

  return reservationId;
}

function simulateConfirmReservation(reservationId: string, paymentIntentId: string): void {
  const reservation = reservations.get(reservationId);
  if (!reservation) {
    const error = new Error('reservation_not_found') as Error & { code: string };
    error.code = 'P0006';
    throw error;
  }
  if (reservation.status === 'confirmed') {
    return;
  }
  if (reservation.status !== 'pending') {
    const error = new Error('not_confirmable') as Error & { code: string };
    error.code = 'P0009';
    throw error;
  }

  reservation.status = 'confirmed';
  reservation.confirmed_at = new Date();

  for (const seat of showtimeSeats.get(reservation.showtime_id) ?? []) {
    if (seat.reservation_id === reservationId) {
      seat.status = 'reserved';
    }
  }

  const payment = payments.get(reservationId);
  if (!payment) {
    const error = new Error('payment_not_found') as Error & { code: string };
    error.code = 'P0010';
    throw error;
  }
  payment.status = 'completed';
  payment.provider_payment_intent_id = paymentIntentId;
}

function simulateFailPayment(reservationId: string): number[] {
  const reservation = reservations.get(reservationId);
  if (!reservation) {
    const error = new Error('reservation_not_found') as Error & { code: string };
    error.code = 'P0006';
    throw error;
  }
  if (reservation.status === 'confirmed') {
    return [];
  }
  if (reservation.status !== 'pending') {
    return [];
  }

  reservation.status = 'expired';
  const seatIds: number[] = [];
  for (const seat of showtimeSeats.get(reservation.showtime_id) ?? []) {
    if (seat.reservation_id === reservationId && seat.status === 'held') {
      seat.status = 'available';
      seat.hold_id = null;
      seat.reservation_id = null;
      seat.version += 1;
      seatIds.push(seat.seat_id);
    }
  }

  const payment = payments.get(reservationId);
  if (payment) {
    payment.status = 'failed';
  }

  return seatIds;
}

function simulateCancelReservation(reservationId: string, userId: string): number[] {
  const reservation = reservations.get(reservationId);
  if (!reservation) {
    const error = new Error('reservation_not_found') as Error & { code: string };
    error.code = 'P0006';
    throw error;
  }
  if (reservation.user_id !== userId) {
    const error = new Error('reservation_forbidden') as Error & { code: string };
    error.code = 'P0007';
    throw error;
  }

  reservation.status = 'cancelled';
  reservation.cancelled_at = new Date();

  const releasedSeatIds: number[] = [];
  for (const seat of showtimeSeats.get(reservation.showtime_id) ?? []) {
    if (seat.reservation_id === reservationId) {
      seat.status = 'available';
      seat.hold_id = null;
      seat.reservation_id = null;
      seat.version += 1;
      releasedSeatIds.push(seat.seat_id);
    }
  }

  return releasedSeatIds;
}

function installDbMocks(): void {
  const handleRead = async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM showtimes st') && sql.includes('INNER JOIN screens sc')) {
      const showtimeId = params?.[0] as string;
      const showtime = showtimes.get(showtimeId);
      if (!showtime) {
        return { rows: [], rowCount: 0 };
      }
      const rows = (showtimeSeats.get(showtimeId) ?? [])
        .map((state) => {
          const seat = screenSeats.get(state.seat_id);
          if (!seat) {
            return null;
          }
          return {
            seat_id: seat.id,
            label: seat.label,
            row_label: seat.row_label,
            col_number: seat.col_number,
            status: state.status,
            row_count: ROW_LABELS.length,
            col_count: COLS,
            price_cents: showtime.price_cents,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('SELECT status FROM showtimes WHERE id = $1')) {
      const showtimeId = params?.[0] as string;
      const showtime = showtimes.get(showtimeId);
      return { rows: showtime ? [{ status: showtime.status }] : [], rowCount: showtime ? 1 : 0 };
    }

    if (sql.includes('FROM seat_holds') && sql.includes('WHERE id = $1')) {
      const holdId = params?.[0] as string;
      const hold = holds.get(holdId);
      return {
        rows: hold
          ? [
              {
                id: hold.id,
                user_id: hold.user_id,
                showtime_id: hold.showtime_id,
                expires_at: hold.expires_at,
                released_at: hold.released_at,
              },
            ]
          : [],
        rowCount: hold ? 1 : 0,
      };
    }

    if (sql.includes('FROM payments') && sql.includes('WHERE reservation_id = $1')) {
      const reservationId = params?.[0] as string;
      const row = payments.get(reservationId);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('FROM reservations') && sql.includes('WHERE id = $1')) {
      const id = params?.[0] as string;
      const row = reservations.get(id);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('idempotency_key = $2')) {
      const userId = params?.[0] as string;
      const key = params?.[1] as string;
      const row = [...reservations.values()].find(
        (reservation) => reservation.user_id === userId && reservation.idempotency_key === key,
      );
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('FROM reservation_seats rs')) {
      const reservationId = params?.[0] as string;
      const seatIds = reservationSeatLinks.get(reservationId) ?? [];
      const rows = seatIds
        .map((showtimeSeatId) => {
          for (const states of showtimeSeats.values()) {
            const state = states.find((seat) => seat.id === showtimeSeatId);
            if (state) {
              const seat = screenSeats.get(state.seat_id);
              return seat ? { label: seat.label } : null;
            }
          }
          return null;
        })
        .filter((row): row is { label: string } => row !== null);
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('FROM users WHERE id = $1')) {
      const userId = params?.[0] as string;
      const user = users.get(userId);
      return {
        rows: user
          ? [
              {
                id: user.id,
                email: user.email,
                password_hash: null,
                name: 'Test User',
                role: user.role,
                email_verified_at: user.email_verified_at,
                google_id: null,
              },
            ]
          : [],
        rowCount: user ? 1 : 0,
      };
    }

    return { rows: [], rowCount: 0 };
  };

  const handleWrite = async (sql: string, params?: unknown[]) => {
    if (sql.includes('fn_hold_seats')) {
      simulateHoldSeats(
        params?.[0] as string,
        params?.[1] as string,
        params?.[2] as string,
        params?.[3] as number[],
        params?.[4] as Date,
      );
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('INSERT INTO payments')) {
      const reservationId = params?.[0] as string;
      const row: PaymentRow = {
        id: randomUUID(),
        reservation_id: reservationId,
        provider: 'stripe',
        provider_payment_intent_id: null,
        status: 'pending',
        amount_cents: params?.[1] as number,
        currency: params?.[2] as string,
        gateway_response: JSON.parse((params?.[3] as string) ?? '{}'),
        provider_refund_id: null,
        refunded_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      payments.set(reservationId, row);
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes('gateway_response = gateway_response ||')) {
      const reservationId = params?.[0] as string;
      const patch = JSON.parse((params?.[1] as string) ?? '{}');
      const row = payments.get(reservationId);
      if (row) {
        row.gateway_response = { ...row.gateway_response, ...patch };
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('INSERT INTO stripe_webhook_events')) {
      const eventId = params?.[0] as string;
      if (webhookEvents.has(eventId)) {
        return { rows: [], rowCount: 0 };
      }
      webhookEvents.add(eventId);
      return { rows: [{ event_id: eventId }], rowCount: 1 };
    }

    if (sql.includes('fn_create_reservation')) {
      const reservationId = simulateCreateReservation(
        params?.[0] as string,
        params?.[1] as string,
        params?.[2] as string,
        params?.[3] as string,
        params?.[4] as Date,
      );
      return { rows: [{ fn_create_reservation: reservationId }], rowCount: 1 };
    }

    if (sql.includes('fn_confirm_reservation')) {
      simulateConfirmReservation(params?.[0] as string, params?.[1] as string);
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('fn_fail_payment')) {
      const seatIds = simulateFailPayment(params?.[0] as string);
      return { rows: [{ seat_ids: seatIds }], rowCount: 1 };
    }

    if (sql.includes('fn_cancel_reservation')) {
      const seatIds = simulateCancelReservation(params?.[0] as string, params?.[1] as string);
      return { rows: [{ seat_ids: seatIds }], rowCount: 1 };
    }

    if (sql.includes("status = 'refunded'")) {
      const reservationId = params?.[0] as string;
      const row = payments.get(reservationId);
      if (row) {
        row.status = 'refunded';
        row.provider_refund_id = params?.[1] as string;
        row.refunded_at = new Date();
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql.trimStart().startsWith('SELECT')) {
      return handleRead(sql, params);
    }

    return { rows: [], rowCount: 0 };
  };

  vi.mocked(queryRead).mockImplementation(handleRead);
  vi.mocked(queryWrite).mockImplementation(handleWrite);
}

async function holdSeats(seatIds: number[]): Promise<string> {
  const res = await request(app)
    .post('/seats/hold')
    .set('Authorization', `Bearer ${verifiedToken}`)
    .send({ showtimeId: SHOWTIME_ID, seatIds });

  expect(res.status).toBe(200);
  return res.body.holdToken as string;
}

async function createReservation(idempotencyKey: string, seatIds = [1, 2]): Promise<{
  reservationId: string;
  paymentUrl: string;
}> {
  const holdToken = await holdSeats(seatIds);
  const res = await request(app)
    .post('/reservations')
    .set('Authorization', `Bearer ${verifiedToken}`)
    .set('X-Idempotency-Key', idempotencyKey)
    .send({ holdToken });

  expect(res.status).toBe(201);
  return {
    reservationId: res.body.reservation.id as string,
    paymentUrl: res.body.paymentUrl as string,
  };
}

function checkoutCompletedEvent(reservationId: string, eventId = 'evt_test_completed'): object {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_123',
        payment_intent: 'pi_test_123',
        client_reference_id: reservationId,
        metadata: { reservationId },
      },
    },
  };
}

describe('Payments API', () => {
  beforeEach(() => {
    showtimes.clear();
    showtimeSeats.clear();
    holds.clear();
    reservations.clear();
    reservationSeatLinks.clear();
    payments.clear();
    webhookEvents.clear();
    users.clear();
    nextShowtimeSeatId = 1;
    resetMockRedisStore();
    installDbMocks();
    seedScreenSeats();
    seedShowtime();
    seedUsers();

    mockStripeCheckoutCreate.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      payment_intent: 'pi_test_123',
    });
    mockStripeRefundsCreate.mockResolvedValue({ id: 're_test_123' });
    mockStripeConstructEvent.mockReset();
  });

  it('POST /reservations → 201 with non-null paymentUrl', async () => {
    const { paymentUrl } = await createReservation(IDEM_CHECKOUT);
    expect(paymentUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
  });

  it('creates payment row with pending status and matching amount', async () => {
    const { reservationId } = await createReservation(IDEM_CHECKOUT, [3, 4]);
    const payment = payments.get(reservationId);
    expect(payment?.status).toBe('pending');
    expect(payment?.amount_cents).toBe(2400);
  });

  it('uses reservation id as Stripe idempotency key', async () => {
    const { reservationId } = await createReservation(IDEM_CHECKOUT);
    expect(mockStripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reservationId }),
      }),
      { idempotencyKey: reservationId },
    );
  });

  it('webhook confirm → reservation confirmed and seats reserved', async () => {
    const { reservationId } = await createReservation(IDEM_WEBHOOK);
    mockStripeConstructEvent.mockReturnValue(checkoutCompletedEvent(reservationId));

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_valid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({})));

    expect(res.status).toBe(200);
    expect(reservations.get(reservationId)?.status).toBe('confirmed');
    expect(payments.get(reservationId)?.status).toBe('completed');
    const seats = showtimeSeats.get(SHOWTIME_ID) ?? [];
    expect(seats.filter((seat) => seat.reservation_id === reservationId).every((s) => s.status === 'reserved')).toBe(
      true,
    );
  });

  it('duplicate webhook event id → 200 no-op', async () => {
    const { reservationId } = await createReservation(IDEM_WEBHOOK);
    mockStripeConstructEvent.mockReturnValue(checkoutCompletedEvent(reservationId, 'evt_dup'));

    await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_valid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    const second = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_valid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    expect(second.status).toBe(200);
    expect(webhookEvents.has('evt_dup')).toBe(true);
  });

  it('invalid webhook signature → 400', async () => {
    mockStripeConstructEvent.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_bad')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(400);
  });

  it('payment_intent.payment_failed → reservation expired and seats released', async () => {
    const { reservationId } = await createReservation(IDEM_WEBHOOK, [5]);
    mockStripeConstructEvent.mockReturnValue({
      id: 'evt_failed',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_failed',
          metadata: { reservationId },
        },
      },
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_valid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(200);
    expect(reservations.get(reservationId)?.status).toBe('expired');
    expect(payments.get(reservationId)?.status).toBe('failed');
    const seat = getShowtimeSeat(SHOWTIME_ID, 5);
    expect(seat?.status).toBe('available');
  });

  it('checkout.session.expired → reservation expired', async () => {
    const { reservationId } = await createReservation(IDEM_WEBHOOK, [6]);
    mockStripeConstructEvent.mockReturnValue({
      id: 'evt_expired',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired',
          client_reference_id: reservationId,
          metadata: { reservationId },
        },
      },
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_valid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(200);
    expect(reservations.get(reservationId)?.status).toBe('expired');
  });

  it('GET payment-status pending', async () => {
    const { reservationId } = await createReservation(IDEM_STATUS);
    const res = await request(app)
      .get(`/reservations/${reservationId}/payment-status`)
      .set('Authorization', `Bearer ${verifiedToken}`);

    expect(res.status).toBe(200);
    expect(paymentStatusResponseSchema.parse(res.body)).toEqual({
      status: 'pending',
      paymentStatus: 'pending',
    });
  });

  it('GET payment-status completed after confirm', async () => {
    const { reservationId } = await createReservation(IDEM_STATUS);
    mockStripeConstructEvent.mockReturnValue(checkoutCompletedEvent(reservationId, 'evt_status'));

    await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_valid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    const res = await request(app)
      .get(`/reservations/${reservationId}/payment-status`)
      .set('Authorization', `Bearer ${verifiedToken}`);

    expect(res.status).toBe(200);
    expect(paymentStatusResponseSchema.parse(res.body)).toEqual({
      status: 'confirmed',
      paymentStatus: 'completed',
    });
  });

  it('GET payment-status forbidden for other user', async () => {
    const { reservationId } = await createReservation(IDEM_STATUS);
    const res = await request(app)
      .get(`/reservations/${reservationId}/payment-status`)
      .set('Authorization', `Bearer ${otherUserToken}`);

    expect(res.status).toBe(403);
  });

  it('DELETE confirmed paid reservation → refundId', async () => {
    const { reservationId } = await createReservation(IDEM_REFUND, [8]);
    mockStripeConstructEvent.mockReturnValue(checkoutCompletedEvent(reservationId, 'evt_refund'));

    await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_valid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    const res = await request(app)
      .delete(`/reservations/${reservationId}`)
      .set('Authorization', `Bearer ${verifiedToken}`);

    expect(res.status).toBe(200);
    expect(cancelReservationResponseSchema.parse(res.body)).toEqual({
      success: true,
      refundId: 're_test_123',
    });
    expect(mockStripeRefundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_test_123' },
      { idempotencyKey: reservationId },
    );
  });

  it('DELETE pending unpaid → no refund call', async () => {
    const { reservationId } = await createReservation(IDEM_NO_REFUND, [9]);
    mockStripeRefundsCreate.mockClear();

    const res = await request(app)
      .delete(`/reservations/${reservationId}`)
      .set('Authorization', `Bearer ${verifiedToken}`);

    expect(res.status).toBe(200);
    expect(cancelReservationResponseSchema.parse(res.body)).toEqual({ success: true });
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
  });
});
