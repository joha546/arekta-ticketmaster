import Stripe from 'stripe';
import type { Env } from '../config/env.js';

export function createStripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    typescript: true,
  });
}
