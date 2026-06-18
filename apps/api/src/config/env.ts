import { z } from 'zod';
import { resolvePemValue } from './pem.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:8088'),
  DATABASE_PRIMARY_URL: z
    .string()
    .default('postgresql://app:app@localhost:5432/arekta'),
  DATABASE_REPLICA_1_URL: z
    .string()
    .default('postgresql://app:app@localhost:5433/arekta'),
  DATABASE_REPLICA_2_URL: z
    .string()
    .default('postgresql://app:app@localhost:5434/arekta'),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  JWT_PUBLIC_KEY: z.string().default(''),
  JWT_PRIVATE_KEY: z.string().default(''),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  EMAIL_FROM: z.string().default('noreply@arekta.local'),
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  APP_URL: z.string().default('http://localhost:3000'),
  IMGBB_API_KEY: z.string().default(''),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4317'),
  OTEL_SERVICE_NAME: z.string().default('api'),
  HOLD_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_SUCCESS_URL: z
    .string()
    .default('http://localhost:8088/reservations/success'),
  STRIPE_CANCEL_URL: z.string().default('http://localhost:8088/reservations/cancel'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(options?: { requireJwt?: boolean }): Env {
  const parsed = envSchema.parse(process.env);
  const env = {
    ...parsed,
    JWT_PUBLIC_KEY: resolvePemValue(parsed.JWT_PUBLIC_KEY),
    JWT_PRIVATE_KEY: resolvePemValue(parsed.JWT_PRIVATE_KEY),
  };

  if (options?.requireJwt === false) {
    return env;
  }

  if (!env.JWT_PRIVATE_KEY.includes('-----BEGIN')) {
    throw new Error(
      'JWT_PRIVATE_KEY is not a valid PEM. For Docker, ensure private.pem exists at the repo root and is mounted (see docker-compose.yml).',
    );
  }
  if (!env.JWT_PUBLIC_KEY.includes('-----BEGIN')) {
    throw new Error(
      'JWT_PUBLIC_KEY is not a valid PEM. For Docker, ensure public.pem exists at the repo root and is mounted (see docker-compose.yml).',
    );
  }

  return env;
}
