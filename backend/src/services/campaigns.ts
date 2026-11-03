import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/db';
import { HttpError } from '../utils/errors';
import { chunk } from '../utils/helpers';
import { searchSyncQueue } from '../lib/queues';
import { planSendTimes } from './plan';
import { enqueueEmails } from './scheduler';

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // in total: the same files go with every email, and an Ethereal mailbox holds ~100 MB
const AttachmentInput = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(200),
  content: z.base64(),
});

export const CampaignInput = z.object({
  campaignId: z.uuid(), // made once by the Compose form, so submitting the same form twice creates one campaign
  senderId: z.uuid(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000), // plain text: the text part, previews and search
  html: z.string().max(200_000).optional(), // the formatted version from the editor
  attachments: z
    .array(AttachmentInput)
    .max(3, 'Up to 3 attachments')
    .refine((files) => files.reduce((n, f) => n + Buffer.byteLength(f.content, 'base64'), 0) <= MAX_ATTACHMENT_BYTES, 'Attachments can be 2 MB in total')
    .default([]),
  leads: z.array(z.string().trim().toLowerCase().pipe(z.email())).min(1).max(10_000),
  startAt: z.coerce.date(),
  delayMs: z.number().int().min(0).max(3_600_000),
  hourlyLimit: z.number().int().min(1).max(10_000),
});
export type CampaignInput = z.infer<typeof CampaignInput>;

export async function scheduleCampaign(userId: string, input: CampaignInput) {
  const sender = await prisma.sender.findFirst({ where: { id: input.senderId, userId, status: 'active' } });
  if (!sender) throw new HttpError(404, 'Sender not found');

  const now = Date.now();
  if (input.startAt.getTime() < now - 60_000) throw new HttpError(400, 'Start time is in the past');
  const startAt = Math.max(now, input.startAt.getTime());

  const leads = [...new Set(input.leads)];
  const times = planSendTimes(leads.length, startAt, input.delayMs, input.hourlyLimit, env.RATE_LIMIT_WINDOW_MS);
  const { campaignId } = input;
  const actor = `user:${userId}`;
  const rows = leads.map((toEmail, i) => ({
    id: crypto.randomUUID(),
    campaignId,
    userId,
    senderId: sender.id,
    toEmail,
    scheduledAt: new Date(times[i]),
  }));

  // Rows first, in one transaction: nothing is half-saved, and the queue can always be rebuilt from them.
  const created = await prisma.$transaction(
    async (tx) => {
      // One campaign per user at a time: without it, parallel submits all count the same "waiting" total and pass the cap together.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      // ON CONFLICT DO NOTHING: a second submit (double-click, resend after an error) waits for the first, then adds nothing.
      const { count } = await tx.campaign.createMany({
        data: [
          {
            id: campaignId,
            userId,
            senderId: sender.id,
            subject: input.subject,
            body: input.body,
            html: input.html || null,
            startAt: new Date(startAt),
            delayMs: input.delayMs,
            hourlyLimit: input.hourlyLimit,
          },
        ],
        skipDuplicates: true,
      });
      if (count === 0) return false;
      // After the duplicate check, so resubmitting an accepted form still gets its answer. Throwing rolls the campaign back.
      const cap = env.MAX_PENDING_EMAILS_PER_USER;
      const waiting = await tx.email.count({ where: { userId, status: { in: ['scheduled', 'sending'] } } });
      if (waiting + rows.length > cap) {
        throw new HttpError(429, `You have ${waiting} emails waiting to send, and at most ${cap} can wait at once. Upload up to ${Math.max(0, cap - waiting)} leads, or wait for some to send.`);
      }
      if (input.attachments.length) {
        await tx.attachment.createMany({
          data: input.attachments.map(({ content, ...a }) => {
            const data = Buffer.from(content, 'base64');
            return { campaignId, ...a, size: data.length, data };
          }),
        });
      }
      for (const part of chunk(rows, 1000)) {
        await tx.email.createMany({ data: part });
        await tx.auditEvent.createMany({
          data: part.map((r) => ({
            userId,
            campaignId,
            emailId: r.id,
            type: 'scheduled',
            actor,
            toStatus: 'scheduled',
            data: { scheduledAt: r.scheduledAt.toISOString() },
          })),
        });
      }
      await tx.auditEvent.create({
        data: {
          userId,
          campaignId,
          type: 'campaign_created',
          actor,
          data: {
            leads: rows.length,
            senderId: sender.id,
            startAt: new Date(startAt).toISOString(),
            delayMs: input.delayMs,
            hourlyLimit: input.hourlyLimit,
            attachments: input.attachments.map((a) => a.filename),
          },
        },
      });
      return true;
    },
    { timeout: 60_000 },
  );

  if (!created) {
    // Answer with what the first submit created. Another user's campaign id matches no rows.
    const agg = await prisma.email.aggregate({
      where: { campaignId, userId },
      _count: true,
      _min: { scheduledAt: true },
      _max: { scheduledAt: true },
    });
    if (!agg._count) throw new HttpError(409, 'Campaign id already used');
    const { _count: count, _min, _max } = agg;
    return { campaignId, count, duplicatesRemoved: input.leads.length - count, firstSendAt: _min.scheduledAt, lastSendAt: _max.scheduledAt };
  }

  await enqueueEmails(rows);
  await searchSyncQueue.add('campaign', { campaignId }, { jobId: `campaign-${campaignId}` });

  return {
    campaignId,
    count: rows.length,
    duplicatesRemoved: input.leads.length - leads.length,
    firstSendAt: rows[0].scheduledAt,
    lastSendAt: rows[rows.length - 1].scheduledAt,
  };
}
