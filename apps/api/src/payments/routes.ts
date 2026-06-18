import { Router, type Router as ExpressRouter } from 'express';
import type pino from 'pino';
import type { Env } from '../config/env.js';
import { createPaymentsService } from './service.js';
import { createStripeClient } from './stripe.js';

/**
 * Stripe webhook endpoint — mounted at `/webhooks/stripe` with raw JSON body.
 */
export function createStripeWebhookRouter(env: Env, logger: pino.Logger): ExpressRouter {
  const router = Router();
  const payments = createPaymentsService(env);

  router.post('/', async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      res.status(400).json({
        error: { code: 'INVALID_SIGNATURE', message: 'Missing stripe-signature header' },
      });
      return;
    }

    let event;
    try {
      const stripe = createStripeClient(env);
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        env.STRIPE_WEBHOOK_SECRET || 'whsec_test',
      );
    } catch {
      res.status(400).json({
        error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' },
      });
      return;
    }

    try {
      await payments.handleWebhookEvent(event, logger);
      res.status(200).json({ received: true });
    } catch (error) {
      logger.error({ err: error, eventId: event.id }, 'Stripe webhook handler failed');
      res.status(500).json({
        error: { code: 'WEBHOOK_HANDLER_ERROR', message: 'Webhook processing failed' },
      });
    }
  });

  return router;
}
