import { type Processor, Worker } from 'bullmq';
import { env } from './config';
import { prisma } from './db';
import { redis } from './redis';
import { closeTransports } from './services/mailer';
import { processEmail } from './workers/emailWorker';

const processors: Record<string, Processor> = {
  emails: processEmail,
};

const workers = env.WORKER_QUEUES.split(',')
  .map((name) => name.trim())
  .filter(Boolean)
  .flatMap((name) => {
    const processor = processors[name];
    if (!processor) {
      console.warn(`worker: no processor for queue "${name}" yet, skipping`);
      return [];
    }
    const worker = new Worker(name, processor, { connection: redis, concurrency: env.WORKER_CONCURRENCY });
    worker.on('failed', (job, err) => console.warn(`[${name}] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
    worker.on('error', (err) => console.error(`[${name}]`, err));
    return [worker];
  });

console.log(`worker ${process.pid}: ${workers.map((w) => w.name).join(', ') || 'nothing'} (concurrency ${env.WORKER_CONCURRENCY})`);

// Graceful shutdown: stop taking jobs, let active ones finish, so deploys don't leave stalled jobs.
async function shutdown(signal: string) {
  console.log(`${signal}: finishing active jobs...`);
  await Promise.all(workers.map((w) => w.close()));
  closeTransports();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
