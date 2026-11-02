// Needs Postgres from `docker compose up`. Slack itself is never called: fetch is stubbed.
import crypto from 'node:crypto';
import { type Job, UnrecoverableError } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.RATE_LIMIT_WINDOW_MS = '60000'; // the demo window, so the message says "per minute"
});

import { encrypt } from '../crypto';
import { prisma } from '../db';
import type { NotificationJob } from '../queues';
import { processNotification } from '../workers/notificationsWorker';
import { limitMessage } from './slack';

describe('limitMessage', () => {
  it('escapes user text and names the real window', () => {
    const m = limitMessage({ scope: 'per_sender', senderEmail: 'a@x.io', subject: '<!channel> & co', limit: 5, resumeAt: Date.UTC(2026, 10, 2, 15), queued: 10 });
    const all = JSON.stringify(m);
    expect(all).toContain('&lt;!channel&gt; &amp; co');
    expect(all).not.toContain('<!channel>');
    expect(m.text).toBe('⚠️ Limit reached for a@x.io (5 per minute). Sending resumes at 15:00 UTC.');
  });
});

describe('processNotification', () => {
  const userId = crypto.randomUUID();
  const fetchMock = vi.fn();
  const job = { data: { kind: 'connected', userId }, attemptsMade: 0 } as Job<NotificationJob>;
  const connect = () =>
    prisma.slackIntegration.upsert({
      where: { userId },
      create: { userId, teamId: 't', teamName: 'T', channel: '#alerts', channelId: 'c', webhookUrlEnc: encrypt('https://hooks.slack.com/test'), accessTokenEnc: encrypt('') },
      update: { status: 'active', lastError: null },
    });
  const status = async () => (await prisma.slackIntegration.findUnique({ where: { userId } }))?.status;

  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchMock);
    await prisma.user.create({ data: { id: userId, googleId: `test:${userId}`, email: 'slack@test.local', name: 'Test' } });
  });
  beforeEach(() => fetchMock.mockReset());
  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.slackIntegration.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('skips quietly when Slack is not connected', async () => {
    await processNotification(job);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the decrypted webhook', async () => {
    await connect();
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    await processNotification(job);
    expect(fetchMock.mock.calls[0][0]).toBe('https://hooks.slack.com/test');
  });

  it('marks the integration broken on a permanent error, and retries a temporary one', async () => {
    await connect();
    fetchMock.mockResolvedValue(new Response('channel_not_found', { status: 404 }));
    await expect(processNotification(job)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await status()).toBe('broken');

    await connect();
    fetchMock.mockResolvedValue(new Response('internal_error', { status: 500 }));
    const err = await processNotification(job).catch((e) => e);
    expect(err).not.toBeInstanceOf(UnrecoverableError); // a plain error: BullMQ retries it
    expect(await status()).toBe('active');
  });
});
