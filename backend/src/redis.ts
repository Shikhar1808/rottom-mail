import { Redis } from 'ioredis';
import { env } from './config';

// BullMQ workers use blocking commands, which require maxRetriesPerRequest: null.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
