// Integration tests for "each email is sent once and never lost". Needs `docker compose up` (Postgres + Redis).
// Uses the dev database with a throwaway user and a throwaway queue. Rows are deleted afterwards; their audit events
// stay, because the audit table is append-only.
import crypto from 'node:crypto';
import { type Job, Worker } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('../../src/services/mailer', () => ({ transportFor: () => ({ sendMail }) }));
// Rate limits have their own tests (limiter.test.ts); here every email may send right away.
vi.mock('../../src/services/limiter', async (importOriginal) => ({ ...(await importOriginal<object>()), gate: async () => undefined }));
vi.mock('../../src/lib/queues', async () => {
  const { Queue } = await import('bullmq');
  const { redis } = await import('../../src/lib/redis');
  return {
    emailQueue: new Queue(`test-emails-${crypto.randomUUID()}`, { connection: redis }),
    searchSyncQueue: { add: async () => undefined },
  };
});

import { prisma } from '../../src/lib/db';
import { emailQueue, type EmailJob } from '../../src/lib/queues';
import { redis } from '../../src/lib/redis';
import { CampaignInput, scheduleCampaign } from '../../src/services/campaigns';
import { repairQueues } from '../../src/services/scheduler';
import { processEmail } from '../../src/workers/emailWorker';

const userId = crypto.randomUUID();
const senderId = crypto.randomUUID();
const campaignId = crypto.randomUUID();

const newEmail = async () =>
  (await prisma.email.create({ data: { campaignId, userId, senderId, toEmail: `${crypto.randomUUID()}@test.local`, scheduledAt: new Date() } })).id;
const status = async (id: string) => (await prisma.email.findUniqueOrThrow({ where: { id } })).status;
const fakeJob = (emailId: string) => ({ data: { emailId }, attemptsMade: 0, opts: { attempts: 8 }, moveToDelayed: vi.fn(), updateData: vi.fn() }) as unknown as Job<EmailJob>;
const smtpError = (responseCode?: number, code?: string) => Object.assign(new Error(`smtp ${responseCode ?? code}`), { responseCode, code });
const accepted = { messageId: 'm', response: '250 Accepted' };

beforeAll(async () => {
  await prisma.user.create({ data: { id: userId, googleId: `test:${userId}`, email: 'test@test.local', name: 'Test' } });
  await prisma.sender.create({
    data: { id: senderId, userId, email: `${senderId}@test.local`, smtpUser: 'x', smtpPassEnc: 'x', smtpHost: 'x', smtpPort: 587, imapHost: 'x', imapPort: 993 },
  });
  await prisma.campaign.create({ data: { id: campaignId, userId, senderId, subject: 's', body: 'b', startAt: new Date(), delayMs: 0, hourlyLimit: 10 } });
});

beforeEach(() => {
  sendMail.mockReset();
});

afterAll(async () => {
  await emailQueue.obliterate({ force: true });
  await emailQueue.close();
  await prisma.email.deleteMany({ where: { userId } });
  await prisma.campaign.deleteMany({ where: { userId } });
  await prisma.sender.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await redis.quit();
  await prisma.$disconnect();
});

describe('processEmail', () => {
  it('two workers racing on one email send it once', async () => {
    sendMail.mockResolvedValue(accepted);
    const id = await newEmail();
    await Promise.allSettled([processEmail(fakeJob(id)), processEmail(fakeJob(id))]);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(await status(id)).toBe('sent');
  });

  it('5xx fails, 4xx moves to the next window, no SMTP reply parks as needs_check', async () => {
    const cases = [
      [smtpError(550), 'failed'],
      [smtpError(421), 'scheduled'],
      [smtpError(undefined, 'ECONNECTION'), 'needs_check'],
    ] as const;
    for (const [err, expected] of cases) {
      sendMail.mockRejectedValueOnce(err);
      const id = await newEmail();
      await expect(processEmail(fakeJob(id))).rejects.toThrow();
      expect(await status(id)).toBe(expected);
    }
  });

  it('records sent even if another job parked the row as needs_check mid-send', async () => {
    const id = await newEmail();
    sendMail.mockImplementationOnce(async () => {
      await prisma.email.update({ where: { id }, data: { status: 'needs_check' } });
      return accepted;
    });
    await processEmail(fakeJob(id));
    expect(await status(id)).toBe('sent');
  });
});

describe('repairQueues', () => {
  it('re-queues a scheduled email whose job already failed', async () => {
    const id = await newEmail();
    await emailQueue.add('send', { emailId: id }, { jobId: id });
    const worker = new Worker(emailQueue.name, null, { connection: redis });
    const job = await worker.getNextJob('t');
    await job!.moveToFailed(new Error('postgres down'), 't');
    await worker.close();
    expect(await emailQueue.getJobState(id)).toBe('failed');

    await repairQueues();
    expect(await emailQueue.getJobState(id)).toBe('waiting');
  });
});

// Last: it adds waiting jobs, and the repair test above takes the next job from the queue.
describe('scheduleCampaign', () => {
  it('the same form submitted twice at once creates one campaign', async () => {
    const input = CampaignInput.parse({
      campaignId: crypto.randomUUID(),
      senderId,
      subject: 's',
      body: 'b',
      leads: ['a@test.local', 'B@test.local', 'b@test.local'],
      startAt: new Date().toISOString(),
      delayMs: 0,
      hourlyLimit: 10,
    });
    const results = await Promise.all([scheduleCampaign(userId, input), scheduleCampaign(userId, input)]);
    expect(results.map((r) => r.count)).toEqual([2, 2]);
    expect(await prisma.email.count({ where: { campaignId: input.campaignId } })).toBe(2);
  });
});
