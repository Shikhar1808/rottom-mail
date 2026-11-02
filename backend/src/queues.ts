import { Queue, type DefaultJobOptions } from 'bullmq';
import { redis } from './redis';

export type EmailJob = { emailId: string; slot?: number };
export type SearchSyncJob = { emailId: string } | { emailIds: string[] } | { campaignId: string };
export type NotificationJob =
  | { kind: 'connected'; userId: string }
  | { kind: 'limit_reached'; userId: string; scope: 'per_sender' | 'global'; senderId: string; campaignId: string; limit: number; resumeAt: number };

const defaults: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86_400, count: 1000 }, // keep recent ones visible in Bull Board
  removeOnFail: { age: 7 * 86_400 },
};

export const emailQueue = new Queue<EmailJob>('emails', {
  connection: redis,
  defaultJobOptions: { ...defaults, attempts: 8 }, // 5s doubling ≈ 10 min of retries: outlasts a short Postgres restart
});
export const searchSyncQueue = new Queue<SearchSyncJob>('search-sync', {
  connection: redis,
  defaultJobOptions: { ...defaults, attempts: 10 },
});
export const notificationsQueue = new Queue<NotificationJob>('notifications', {
  connection: redis,
  defaultJobOptions: { ...defaults, attempts: 5 },
});

export const allQueues = [emailQueue, searchSyncQueue, notificationsQueue];
