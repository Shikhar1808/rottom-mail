import { createApp } from './app';
import { env } from './config';
import { prisma } from './db';
import { redis } from './redis';
import { repairQueues } from './services/scheduler';

const server = createApp().listen(env.PORT, () => {
  console.log(`api listening on http://localhost:${env.PORT} (public origin ${env.APP_URL})`);
});

repairQueues().catch((err) => console.error('startup repair failed:', err));

async function shutdown(signal: string) {
  console.log(`${signal}: closing api`);
  server.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
