// Worker process entry (npm run dev:worker): runs the queues listed in WORKER_QUEUES.
import { type Processor, Worker } from 'bullmq';
import { env } from '../config/env';
import { prisma } from '../lib/db';
import { errorFields, log } from '../lib/log';
import { redis } from '../lib/redis';
import { closeTransports } from '../services/mailer';
import { processEmail } from './emailWorker';
import { processNotification } from './notificationsWorker';
import { processSearchSync } from './searchSyncWorker';

const processors: Record<string, Processor> = {
  emails: processEmail,
  notifications: processNotification,
  'search-sync': processSearchSync,
};

const workers = env.WORKER_QUEUES.split(',')
  .map((name) => name.trim())
  .filter(Boolean)
  .flatMap((name) => {
    const processor = processors[name];
    if (!processor) {
      log.warn('no processor for this queue, skipping', { queue: name });
      return [];
    }
    // Global mode: BullMQ's Redis-backed limiter gives the minimum delay across all workers (1 start per gap).
    // It must exist even with a 0 gap: without it the hourly pause (queue.rateLimit) is ignored and jobs spin.
    const limiter =
      name === 'emails' && env.RATE_LIMIT_MODE === 'global' ? { max: 1, duration: Math.max(1, env.MIN_DELAY_BETWEEN_SENDS_MS) } : undefined;
    const worker = new Worker(name, processor, { connection: redis, concurrency: env.WORKER_CONCURRENCY, limiter });
    worker.on('failed', (job, err) => {
      const final = err.name === 'UnrecoverableError' || (job?.attemptsMade ?? 0) >= (job?.opts.attempts ?? 1);
      log[final ? 'error' : 'warn'](final ? 'job failed for good' : 'job failed, will retry', { queue: name, jobId: job?.id, attempt: job?.attemptsMade, ...errorFields(err) });
    });
    worker.on('error', (err) => log.error('worker error', { queue: name, ...errorFields(err) }));
    return [worker];
  });

log.info('worker started', { pid: process.pid, queues: workers.map((w) => w.name).join(',') || 'none', concurrency: env.WORKER_CONCURRENCY, rateLimit: env.RATE_LIMIT_MODE, windowMs: env.RATE_LIMIT_WINDOW_MS });

// Graceful shutdown: stop taking jobs, let active ones finish, so deploys don't leave stalled jobs.
async function shutdown(signal: string) {
  log.info('worker stopping, finishing active jobs', { signal });
  await Promise.all(workers.map((w) => w.close()));
  closeTransports();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
