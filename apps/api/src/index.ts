import { config as loadDotenv } from 'dotenv';
import type { Express } from 'express';
import { loadEnv } from './config/env.js';
import { initPools } from './db/pools.js';
import { initInstrumentation, shutdownInstrumentation } from './instrumentation.js';
import { createLogger } from './middleware/logger.js';
import { createApp } from './app.js';
import { closeRedis } from './redis/client.js';
import { startShowtimeCompletionScheduler } from './showtimes/scheduler.js';
import { startHoldExpiryJob } from './seats/holdJob.js';

loadDotenv();
initInstrumentation();

const env = loadEnv();
const logger = createLogger(env);
initPools(env);

const app: Express = createApp(env, logger);

startShowtimeCompletionScheduler();
startHoldExpiryJob(env);

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API server started');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    const { closePools } = await import('./db/pools.js');
    await closePools();
    await closeRedis();
    await shutdownInstrumentation();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { app };
