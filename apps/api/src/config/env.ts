import { z } from 'zod';

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
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4317'),
  OTEL_SERVICE_NAME: z.string().default('api'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}
