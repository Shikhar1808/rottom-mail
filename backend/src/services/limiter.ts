import { DelayedError, type Job, RateLimitError } from 'bullmq';
import { env } from '../config/env';
import { emailQueue, type EmailJob, notificationsQueue } from '../lib/queues';
import { redis } from '../lib/redis';
import { log } from '../lib/log';
import { audit, type Ev, updateEmail } from './emails';
type GateEmail = { id: string; userId: string; senderId: string; campaignId: string };

const WIN = env.RATE_LIMIT_WINDOW_MS;
const windowOf = (t: number) => Math.floor(t / WIN);

// One atomic step per sender (docs/04): book the next free slot, MIN_DELAY apart, in that slot's window.
// If the window is full, hand out next-window times in arrival order instead. Returns {slot, deferTo, hitLimit}.
const RESERVE_SLOT = `
local now, gap, limit, win = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local slot = math.max(now, tonumber(redis.call('GET', KEYS[1]) or '0'))
local window = math.floor(slot / win)
local count = redis.call('INCR', KEYS[2] .. window)
if count == 1 then redis.call('PEXPIRE', KEYS[2] .. window, win * 2) end
if count > limit then
  local seq = redis.call('INCR', KEYS[3] .. window)
  redis.call('PEXPIRE', KEYS[3] .. window, win * 2)
  return {0, (window + 1) * win + (seq - 1) * gap, 0}
end
redis.call('SET', KEYS[1], slot + gap, 'PX', slot + gap - now + win) -- kept until past the last booked slot
return {slot, 0, count == limit and 1 or 0}
`;

export async function reserveSlot(
  senderId: string,
  now: number,
  gap = env.MIN_DELAY_BETWEEN_SENDS_MS,
  limit = env.MAX_EMAILS_PER_HOUR_PER_SENDER,
  win = WIN,
) {
  const k = `rl:{sender:${senderId}}:`; // {hash tag}: all of a sender's keys land on one Redis Cluster slot
  const [slot, deferTo, hit] = (await redis.eval(RESERVE_SLOT, 3, `${k}next`, `${k}count:`, `${k}overflow:`, now, gap, limit, win)) as number[];
  return { slot, deferTo, hitLimit: hit === 1 };
}

/** Puts the job back to sleep until `until` without using an attempt. Any booked slot is dropped: it books again on waking. */
export async function sleepUntil(job: Job<EmailJob>, token: string | undefined, until: number) {
  await job.updateData({ emailId: job.data.emailId });
  await job.moveToDelayed(until, token);
  return new DelayedError();
}

/** The start of the next limiter window: where rate-limited and SMTP-4xx emails go. */
export const nextWindow = (now = Date.now()) => (windowOf(now) + 1) * WIN;

async function notifyLimitReached(email: GateEmail, scope: 'per_sender' | 'global', at: number, limit: number) {
  const who = scope === 'global' ? 'global' : email.senderId;
  await notificationsQueue.add(
    'limit_reached',
    { kind: 'limit_reached', userId: email.userId, scope, senderId: email.senderId, campaignId: email.campaignId, limit, resumeAt: nextWindow(at) },
    { jobId: `slack-${email.userId}-${who}-${windowOf(at)}` }, // at most one alert per sender (or system) per window
  );
}

/**
 * The guard layer (docs/04): returns when this email may be sent now. Otherwise it moves the job and throws
 * DelayedError / RateLimitError, which BullMQ doesn't count as a failed attempt.
 */
export async function gate(job: Job<EmailJob>, token: string | undefined, email: GateEmail, ev: Ev) {
  return env.RATE_LIMIT_MODE === 'global' ? globalGate(email, ev) : perSenderGate(job, token, email, ev);
}

async function perSenderGate(job: Job<EmailJob>, token: string | undefined, email: GateEmail, ev: Ev) {
  let slot = job.data.slot; // booked on an earlier pass?
  if (!slot) {
    const limit = env.MAX_EMAILS_PER_HOUR_PER_SENDER;
    const r = await reserveSlot(email.senderId, Date.now());
    if (r.hitLimit) await notifyLimitReached(email, 'per_sender', r.slot, limit);
    if (r.deferTo) {
      const data = { mode: 'per_sender', limit, window: WIN, newTime: new Date(r.deferTo).toISOString() };
      log.info('rate limit: email moved to the next window', { emailId: email.id, senderId: email.senderId, limit, newTime: data.newTime });
      await updateEmail(email.id, { scheduledAt: new Date(r.deferTo) }, ev('deferred_rate_limit', data), ['scheduled']);
      throw await sleepUntil(job, token, r.deferTo);
    }
    slot = r.slot;
  }
  // Not this sender's turn yet: step aside until the booked slot, so the worker is free for other senders.
  if (slot > Date.now() + 50) {
    await job.updateData({ ...job.data, slot });
    await job.moveToDelayed(slot, token);
    throw new DelayedError();
  }
}

// The minimum delay is BullMQ's own limiter on the worker (worker.ts). This adds the hourly cap across all senders.
async function globalGate(email: GateEmail, ev: Ev) {
  const now = Date.now();
  const limit = env.MAX_EMAILS_PER_HOUR;
  const key = `rl:global:count:${windowOf(now)}`;
  const res = await redis.multi().incr(key).pexpire(key, WIN * 2).exec();
  const count = res?.[0]?.[1] as number;
  if (count === limit) await notifyLimitReached(email, 'global', now, limit);
  if (count > limit) {
    // Pause the whole queue until the next window. The job goes back to the front of the line.
    await emailQueue.rateLimit(nextWindow(now) - now);
    if (count === limit + 1) log.warn('rate limit: queue paused until the next window', { limit, until: new Date(nextWindow(now)).toISOString() });
    if (count === limit + 1) await audit({ ...ev('queue_paused', { until: new Date(nextWindow(now)).toISOString(), limit }), emailId: email.id });
    throw new RateLimitError();
  }
}
