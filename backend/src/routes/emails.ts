import { Router } from 'express';
import type { EmailStatus } from '@prisma/client';
import { prisma } from '../db';
import { HttpError } from '../http';
import { emailQueue } from '../queues';
import { updateEmail } from '../services/emails';

export const emailsRouter = Router();

const TABS: Record<'scheduled' | 'sent', EmailStatus[]> = {
  scheduled: ['scheduled', 'sending'],
  sent: ['sent', 'failed', 'needs_check'],
};
const PAGE = 50;

// Tabs read Postgres: always exact, even if Elasticsearch is behind or down.
emailsRouter.get('/', async (req, res) => {
  const tab = req.query.tab === 'sent' ? 'sent' : 'scheduled';
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const rows = await prisma.email.findMany({
    where: { userId: req.userId, status: { in: TABS[tab] } },
    orderBy: tab === 'scheduled' ? [{ scheduledAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: PAGE + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select: {
      id: true,
      toEmail: true,
      status: true,
      scheduledAt: true,
      sentAt: true,
      previewUrl: true,
      error: true,
      campaign: { select: { subject: true } },
      sender: { select: { email: true } },
    },
  });
  const items = rows.slice(0, PAGE).map(({ campaign, sender, ...r }) => ({ ...r, subject: campaign.subject, from: sender.email }));
  res.json({ items, nextCursor: rows.length > PAGE ? items[items.length - 1].id : null });
});

emailsRouter.get('/:id/events', async (req, res) => {
  const events = await prisma.auditEvent.findMany({
    where: { emailId: req.params.id, userId: req.userId },
    orderBy: { id: 'asc' },
  });
  res.json({ items: events.map((e) => ({ ...e, id: e.id.toString() })) }); // BigInt isn't JSON-serialisable
});

// Manual replay for parked or failed emails. Goes through updateEmail, so it's audited (unlike a Bull Board retry).
emailsRouter.post('/:id/retry', async (req, res) => {
  const email = await prisma.email.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!email) throw new HttpError(404, 'Email not found');
  const ok = await updateEmail(
    email.id,
    { status: 'scheduled', scheduledAt: new Date(), error: null },
    { userId: email.userId, campaignId: email.campaignId, type: 'retry_requested', actor: `user:${req.userId}` },
    ['needs_check', 'failed'],
  );
  if (!ok) throw new HttpError(409, 'Only failed or needs-check emails can be retried');
  await emailQueue.add('send', { emailId: email.id }, { jobId: `${email.id}-retry-${email.attempts}` });
  res.json({ ok: true });
});
