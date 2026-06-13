import type pino from 'pino';
import type { Env } from '../config/env.js';

export type VerificationEmailParams = {
  to: string;
  name: string;
  token: string;
};

/**
 * Sends (or logs) the email verification link for new signups.
 * In development/test, EMAIL_PROVIDER=console writes the link to logs.
 */
export async function sendVerificationEmail(
  params: VerificationEmailParams,
  env: Env,
  logger: pino.Logger,
): Promise<void> {
  const verifyUrl = `${env.APP_URL}/auth/verify-email?token=${encodeURIComponent(params.token)}`;

  if (env.EMAIL_PROVIDER === 'console') {
    logger.info(
      {
        to: params.to,
        name: params.name,
        verifyUrl,
      },
      'Verification email (console provider)',
    );
    return;
  }

  // SendGrid and SES integrations are deferred; console is the default for local dev.
  logger.warn(
    { provider: env.EMAIL_PROVIDER },
    'Email provider not fully implemented — logging verification link instead',
  );
  logger.info({ to: params.to, verifyUrl }, 'Verification email fallback');
}
