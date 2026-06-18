import type Stripe from 'stripe';
import type pino from 'pino';
import type { Env } from '../config/env.js';
import { eventBus } from '../events/bus.js';
import { AppError } from '../errors/AppError.js';
import type { ReservationRecord } from '../reservations/repository.js';
import * as reservationsRepo from '../reservations/repository.js';
import * as paymentsRepo from './repository.js';
import { createStripeClient } from './stripe.js';

function paymentIntentId(value: string | Stripe.PaymentIntent | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.id;
}

export function createPaymentsService(env: Env) {
  const stripe = createStripeClient(env);

  async function createCheckout(reservation: ReservationRecord): Promise<string> {
    const existing = await paymentsRepo.findByReservationIdFromPrimary(reservation.id);
    if (existing?.gatewayResponse.checkoutUrl && typeof existing.gatewayResponse.checkoutUrl === 'string') {
      return existing.gatewayResponse.checkoutUrl;
    }

    if (!existing) {
      await paymentsRepo.insertPayment({
        reservationId: reservation.id,
        amountCents: reservation.totalAmountCents,
        currency: reservation.currency,
      });
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: reservation.currency.toLowerCase(),
              unit_amount: reservation.totalAmountCents,
              product_data: {
                name: `Reservation ${reservation.referenceCode}`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${env.STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: env.STRIPE_CANCEL_URL,
        client_reference_id: reservation.id,
        metadata: {
          reservationId: reservation.id,
          referenceCode: reservation.referenceCode,
        },
        payment_intent_data: {
          metadata: {
            reservationId: reservation.id,
          },
        },
      },
      { idempotencyKey: reservation.id },
    );

    if (!session.url) {
      throw new AppError('Failed to create Stripe checkout session', 502, 'PAYMENT_GATEWAY_ERROR');
    }

    await paymentsRepo.mergeGatewayResponse(reservation.id, {
      checkoutSessionId: session.id,
      checkoutUrl: session.url,
      checkoutSession: session,
    });

    return session.url;
  }

  async function handleWebhookEvent(event: Stripe.Event, logger: pino.Logger): Promise<void> {
    const isNew = await paymentsRepo.insertWebhookEvent(event.id, event.type);
    if (!isNew) {
      return;
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, logger);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case 'checkout.session.expired':
        await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        break;
      default:
        break;
    }
  }

  async function handleCheckoutCompleted(
    session: Stripe.Checkout.Session,
    logger: pino.Logger,
  ): Promise<void> {
    const reservationId =
      session.metadata?.reservationId ?? session.client_reference_id ?? undefined;
    const intentId = paymentIntentId(session.payment_intent);

    if (!reservationId || !intentId) {
      logger.warn({ sessionId: session.id }, 'Checkout session missing reservation or payment intent');
      return;
    }

    await paymentsRepo.mergeGatewayResponse(reservationId, {
      checkoutSessionCompleted: session,
    });

    try {
      await paymentsRepo.callConfirmReservation(reservationId, intentId);
    } catch (error) {
      if (paymentsRepo.isNotConfirmableError(error)) {
        logger.warn(
          { reservationId, paymentIntentId: intentId },
          'Late payment for non-pending reservation; issuing auto-refund',
        );
        await stripe.refunds.create(
          { payment_intent: intentId },
          { idempotencyKey: `late-refund-${reservationId}` },
        );
        return;
      }
      throw error;
    }

    const owner = await paymentsRepo.findReservationOwner(reservationId);
    if (owner) {
      try {
        eventBus.emit('reservation.confirmed', {
          reservationId,
          userId: owner.userId,
        });
      } catch (emitError) {
        logger.error({ err: emitError, reservationId }, 'Failed to emit reservation.confirmed');
      }
    }
  }

  async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const reservationId = paymentIntent.metadata?.reservationId;
    if (!reservationId) {
      return;
    }

    await paymentsRepo.mergeGatewayResponse(reservationId, {
      paymentIntentFailed: paymentIntent,
    });
    await releaseFailedPayment(reservationId);
  }

  async function handleCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
    const reservationId =
      session.metadata?.reservationId ?? session.client_reference_id ?? undefined;
    if (!reservationId) {
      return;
    }

    await paymentsRepo.mergeGatewayResponse(reservationId, {
      checkoutSessionExpired: session,
    });
    await releaseFailedPayment(reservationId);
  }

  async function releaseFailedPayment(reservationId: string): Promise<void> {
    const { showtimeId, seatIds } = await paymentsRepo.callFailPayment(reservationId);
    if (seatIds.length > 0) {
      const { releaseSeats } = await import('../seats/redisHold.js');
      await releaseSeats(showtimeId, seatIds);
    }
  }

  async function refundPayment(payment: paymentsRepo.PaymentRecord): Promise<string> {
    if (!payment.providerPaymentIntentId) {
      throw new AppError('Payment intent missing for refund', 500, 'PAYMENT_GATEWAY_ERROR');
    }

    const refund = await stripe.refunds.create(
      { payment_intent: payment.providerPaymentIntentId },
      { idempotencyKey: payment.reservationId },
    );

    await paymentsRepo.markRefunded(payment.reservationId, refund.id);
    return refund.id;
  }

  async function getPaymentStatus(reservationId: string): Promise<{
    status: ReservationRecord['status'];
    paymentStatus: paymentsRepo.PaymentRecord['status'];
  } | null> {
    const owner = await paymentsRepo.findReservationOwner(reservationId);
    if (!owner) {
      return null;
    }

    const payment = await paymentsRepo.findByReservationIdFromPrimary(reservationId);
    const reservation = await reservationsRepo.findByIdFromPrimary(reservationId);
    if (!reservation) {
      return null;
    }

    return {
      status: reservation.status,
      paymentStatus: payment?.status ?? 'pending',
    };
  }

  return {
    createCheckout,
    handleWebhookEvent,
    refundPayment,
    getPaymentStatus,
  };
}

export type PaymentsService = ReturnType<typeof createPaymentsService>;
