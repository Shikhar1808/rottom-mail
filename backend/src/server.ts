import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/db';
import { errorFields, log } from './lib/log';
import { redis } from './lib/redis';
import { repairQueues } from './services/scheduler';
import { ensureIndex } from './services/search';

const server = createApp().listen(env.PORT, () => {
  log.info('api listening', { port: env.PORT, origin: env.APP_URL, nodeEnv: env.NODE_ENV });
});

repairQueues().catch((err) => log.error('startup repair failed', errorFields(err)));
// Not fatal: sending and the tabs work without ES; search and the sync worker retry it on their next call.
ensureIndex().catch((err) => log.warn('elasticsearch index setup failed, search will retry', errorFields(err)));

async function shutdown(signal: string) {
  log.info('api stopping', { signal });
  server.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
