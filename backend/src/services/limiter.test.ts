// Needs Redis from `docker compose up`. Keys use random sender ids and expire on their own.
import crypto from 'node:crypto';
import { type Job, RateLimitError } from 'bullmq';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Global-mode settings for the gate test. The odd window keeps its counter key apart from the dev system's.
const WIN = vi.hoisted(() => {
  Object.assign(process.env, { RATE_LIMIT_MODE: 'global', MAX_EMAILS_PER_HOUR: '3', RATE_LIMIT_WINDOW_MS: '86399999' });
  return 86_399_999;
});
vi.mock('../queues', () => ({ emailQueue: { rateLimit: vi.fn() }, notificationsQueue: { add: vi.fn() } }));
vi.mock('./emails', () => ({ audit: vi.fn(), updateEmail: vi.fn() }));

import { emailQueue, type EmailJob, notificationsQueue } from '../queues';
import { redis } from '../redis';
import { gate, reserveSlot } from './limiter';

afterAll(() => redis.quit());

describe('reserveSlot (per-sender Lua)', () => {
  const win = 60_000;
  const gap = 2000;
  const start = (Math.floor(Date.now() / win) + 1) * win; // start of a window, so the slots below fit in it

  it('spaces one sender by the gap, and senders are independent', async () => {
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    const slots = [];
    for (const s of [a, a, b, a]) slots.push((await reserveSlot(s, start, gap, 10, win)).slot);
    expect(slots).toEqual([start, start + gap, start, start + 2 * gap]);
  });

  it('reports the limit once, then moves overflow to the next window in arrival order', async () => {
    const s = crypto.randomUUID();
    const r = [];
    for (let i = 0; i < 5; i++) r.push(await reserveSlot(s, start, gap, 3, win));
    expect(r.map((x) => x.hitLimit)).toEqual([false, false, true, false, false]);
    expect(r.map((x) => x.deferTo)).toEqual([0, 0, 0, start + win, start + win + gap]);
  });

  it('gives parallel callers distinct slots', async () => {
    const s = crypto.randomUUID();
    const slots = (await Promise.all(Array.from({ length: 25 }, () => reserveSlot(s, start, gap, 100, win)))).map((r) => r.slot);
    expect([...slots].sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => start + i * gap));
  });
});

describe('gate (global mode)', () => {
  it('alerts once at the limit, then pauses the queue instead of sending', async () => {
    const key = `rl:global:count:${Math.floor(Date.now() / WIN)}`;
    await redis.del(key);
    const job = { data: { emailId: 'e' } } as Job<EmailJob>;
    const email = { id: 'e', userId: 'u', senderId: 's', campaignId: 'c' };
    const outcomes = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push(await gate(job, undefined, email, (type) => ({ userId: 'u', type, actor: 'test' })).then(() => 'send', (e) => (e instanceof RateLimitError ? 'paused' : e)));
    }
    await redis.del(key);
    expect(outcomes).toEqual(['send', 'send', 'send', 'paused', 'paused']);
    expect(notificationsQueue.add).toHaveBeenCalledTimes(1);
    expect(emailQueue.rateLimit).toHaveBeenCalledTimes(2);
  });
});
