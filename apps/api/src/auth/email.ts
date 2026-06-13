import nodemailer, { type Transporter } from 'nodemailer';
import type pino from 'pino';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

export type VerificationEmailParams = {
  to: string;
  name: string;
  token: string;
};

let cachedTransport: Transporter | null = null;
let cachedTransportKey: string | null = null;

function transportKey(env: Env): string {
  return `${env.SMTP_HOST}:${env.SMTP_PORT}:${env.SMTP_USER}:${env.SMTP_SECURE}`;
}

/**
 * Returns a cached Nodemailer SMTP transport. Recreated only when SMTP env changes.
 */
function getSmtpTransport(env: Env): Transporter {
  const key = transportKey(env);
  if (cachedTransport && cachedTransportKey === key) {
    return cachedTransport;
  }

  const hasAuth = env.SMTP_USER.length > 0 || env.SMTP_PASS.length > 0;

  cachedTransport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: hasAuth
      ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        }
      : undefined,
  });
  cachedTransportKey = key;

  return cachedTransport;
}

function buildVerificationContent(name: string, verifyUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = 'Verify your Arekta account';
  const text = [
    `Hi ${name},`,
    '',
    'Please verify your email address by opening the link below:',
    verifyUrl,
    '',
    'If you did not create an account, you can ignore this email.',
  ].join('\n');

  const html = `
    <p>Hi ${name},</p>
    <p>Please verify your email address by clicking the link below:</p>
    <p><a href="${verifyUrl}">Verify email</a></p>
    <p>Or copy this URL into your browser:</p>
    <p>${verifyUrl}</p>
    <p>If you did not create an account, you can ignore this email.</p>
  `.trim();

  return { subject, text, html };
}

/**
 * Sends (or logs) the email verification link for new signups.
 * - `console`: writes the link to logs (used in tests)
 * - `smtp`: sends via Nodemailer (Mailpit locally, any SMTP in production)
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

  const { subject, text, html } = buildVerificationContent(params.name, verifyUrl);

  try {
    const transport = getSmtpTransport(env);
    await transport.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      subject,
      text,
      html,
    });

    logger.info({ to: params.to }, 'Verification email sent via SMTP');
  } catch (error) {
    logger.error({ err: error, to: params.to }, 'Failed to send verification email');
    throw new AppError('Failed to send verification email', 500, 'EMAIL_SEND_FAILED');
  }
}

/** Clears cached transport — useful in tests when SMTP env changes between cases. */
export function resetEmailTransportForTests(): void {
  cachedTransport = null;
  cachedTransportKey = null;
}
