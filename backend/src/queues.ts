import { Queue, type DefaultJobOptions } from 'bullmq';
import { redis } from './redis';

export type EmailJob = { emailId: string; slot?: number };
export type SearchSyncJob = { emailId: string } | { campaignId: string };

const defaults: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86_400, count: 1000 }, // keep recent ones visible in Bull Board
  removeOnFail: { age: 7 * 86_400 },
};

export const emailQueue = new Queue<EmailJob>('emails', { connection: redis, defaultJobOptions: defaults });
export const searchSyncQueue = new Queue<SearchSyncJob>('search-sync', {
  connection: redis,
  defaultJobOptions: { ...defaults, attempts: 10 },
});
export const notificationsQueue = new Queue('notifications', {
  connection: redis,
  defaultJobOptions: { ...defaults, attempts: 5 },
});

export const allQueues = [emailQueue, searchSyncQueue, notificationsQueue];
