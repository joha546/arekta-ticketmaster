import { queryWrite } from '../db/pools.js';

export type PaymentRecord = {
  id: string;
  reservationId: string;
  provider: string;
  providerPaymentIntentId: string | null;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  amountCents: number;
  currency: string;
  gatewayResponse: Record<string, unknown>;
  providerRefundId: string | null;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const RESERVATION_NOT_FOUND_CODE = 'P0006';
const NOT_CONFIRMABLE_CODE = 'P0009';
const PAYMENT_NOT_FOUND_CODE = 'P0010';
const UNIQUE_VIOLATION_CODE = '23505';

function mapPayment(row: {
  id: string;
  reservation_id: string;
  provider: string;
  provider_payment_intent_id: string | null;
  status: PaymentRecord['status'];
  amount_cents: number;
  currency: string;
  gateway_response: Record<string, unknown>;
  provider_refund_id: string | null;
  refunded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): PaymentRecord {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    provider: row.provider,
    providerPaymentIntentId: row.provider_payment_intent_id,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    gatewayResponse: row.gateway_response ?? {},
    providerRefundId: row.provider_refund_id,
    refundedAt: row.refunded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isPgError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === code
  );
}

export function isReservationNotFoundError(error: unknown): boolean {
  return isPgError(error, RESERVATION_NOT_FOUND_CODE);
}

export function isNotConfirmableError(error: unknown): boolean {
  return isPgError(error, NOT_CONFIRMABLE_CODE);
}

export function isPaymentNotFoundError(error: unknown): boolean {
  return isPgError(error, PAYMENT_NOT_FOUND_CODE);
}

export function isWebhookEventDuplicateError(error: unknown): boolean {
  return isPgError(error, UNIQUE_VIOLATION_CODE);
}

export async function insertPayment(input: {
  reservationId: string;
  amountCents: number;
  currency: string;
  gatewayResponse?: Record<string, unknown>;
}): Promise<PaymentRecord> {
  const result = await queryWrite<{
    id: string;
    reservation_id: string;
    provider: string;
    provider_payment_intent_id: string | null;
    status: PaymentRecord['status'];
    amount_cents: number;
    currency: string;
    gateway_response: Record<string, unknown>;
    provider_refund_id: string | null;
    refunded_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO payments (reservation_id, amount_cents, currency, gateway_response)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING
       id,
       reservation_id,
       provider,
       provider_payment_intent_id,
       status,
       amount_cents,
       currency,
       gateway_response,
       provider_refund_id,
       refunded_at,
       created_at,
       updated_at`,
    [
      input.reservationId,
      input.amountCents,
      input.currency,
      JSON.stringify(input.gatewayResponse ?? {}),
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to create payment');
  }

  return mapPayment(row);
}

export async function findByReservationIdFromPrimary(
  reservationId: string,
): Promise<PaymentRecord | null> {
  const result = await queryWrite<{
    id: string;
    reservation_id: string;
    provider: string;
    provider_payment_intent_id: string | null;
    status: PaymentRecord['status'];
    amount_cents: number;
    currency: string;
    gateway_response: Record<string, unknown>;
    provider_refund_id: string | null;
    refunded_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       id,
       reservation_id,
       provider,
       provider_payment_intent_id,
       status,
       amount_cents,
       currency,
       gateway_response,
       provider_refund_id,
       refunded_at,
       created_at,
       updated_at
     FROM payments
     WHERE reservation_id = $1`,
    [reservationId],
  );

  const row = result.rows[0];
  return row ? mapPayment(row) : null;
}

export async function updateGatewayResponse(
  reservationId: string,
  gatewayResponse: Record<string, unknown>,
): Promise<void> {
  await queryWrite(
    `UPDATE payments
     SET gateway_response = $2::jsonb, updated_at = NOW()
     WHERE reservation_id = $1`,
    [reservationId, JSON.stringify(gatewayResponse)],
  );
}

export async function markRefunded(
  reservationId: string,
  providerRefundId: string,
): Promise<void> {
  await queryWrite(
    `UPDATE payments
     SET
       status = 'refunded',
       provider_refund_id = $2,
       refunded_at = NOW(),
       updated_at = NOW()
     WHERE reservation_id = $1`,
    [reservationId, providerRefundId],
  );
}

export async function callConfirmReservation(
  reservationId: string,
  paymentIntentId: string,
): Promise<void> {
  await queryWrite(`SELECT fn_confirm_reservation($1, $2)`, [reservationId, paymentIntentId]);
}

export async function callFailPayment(reservationId: string): Promise<{
  showtimeId: string;
  seatIds: number[];
}> {
  const reservationResult = await queryWrite<{ showtime_id: string }>(
    `SELECT showtime_id FROM reservations WHERE id = $1`,
    [reservationId],
  );
  const showtimeId = reservationResult.rows[0]?.showtime_id;
  if (!showtimeId) {
    throw new Error('Reservation not found for fail payment');
  }

  const result = await queryWrite<{ seat_ids: number[] }>(
    `SELECT fn_fail_payment($1) AS seat_ids`,
    [reservationId],
  );

  return {
    showtimeId,
    seatIds: result.rows[0]?.seat_ids ?? [],
  };
}

export async function insertWebhookEvent(eventId: string, eventType: string): Promise<boolean> {
  const result = await queryWrite<{ event_id: string }>(
    `INSERT INTO stripe_webhook_events (event_id, event_type)
     VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [eventId, eventType],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function findReservationOwner(
  reservationId: string,
): Promise<{ userId: string; showtimeId: string } | null> {
  const result = await queryWrite<{ user_id: string; showtime_id: string }>(
    `SELECT user_id, showtime_id FROM reservations WHERE id = $1`,
    [reservationId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return { userId: row.user_id, showtimeId: row.showtime_id };
}

export async function mergeGatewayResponse(
  reservationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await queryWrite(
    `UPDATE payments
     SET
       gateway_response = gateway_response || $2::jsonb,
       updated_at = NOW()
     WHERE reservation_id = $1`,
    [reservationId, JSON.stringify(patch)],
  );
}
