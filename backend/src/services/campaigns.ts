import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config';
import { prisma } from '../db';
import { chunk, HttpError } from '../http';
import { searchSyncQueue } from '../queues';
import { planSendTimes } from './plan';
import { enqueueEmails } from './scheduler';

export const CampaignInput = z.object({
  campaignId: z.uuid(), // made once by the Compose form, so submitting the same form twice creates one campaign
  senderId: z.uuid(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
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
      // ON CONFLICT DO NOTHING: a second submit (double-click, resend after an error) waits for the first, then adds nothing.
      const { count } = await tx.campaign.createMany({
        data: [
          {
            id: campaignId,
            userId,
            senderId: sender.id,
            subject: input.subject,
            body: input.body,
            startAt: new Date(startAt),
            delayMs: input.delayMs,
            hourlyLimit: input.hourlyLimit,
          },
        ],
        skipDuplicates: true,
      });
      if (count === 0) return false;
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
          data: { leads: rows.length, senderId: sender.id, startAt: new Date(startAt).toISOString(), delayMs: input.delayMs, hourlyLimit: input.hourlyLimit },
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
