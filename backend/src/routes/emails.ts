import { Router } from 'express';
import { EmailStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { HttpError } from '../utils/errors';
import { retryEmail } from '../services/emails';
import { searchEmailIds } from '../services/search';

export const emailsRouter = Router();

const TABS: Record<'scheduled' | 'sent', EmailStatus[]> = {
  scheduled: ['scheduled', 'sending'],
  sent: ['sent', 'failed', 'needs_check'],
};
const PAGE = 50;

// One row shape for the tabs and the search results.
const rowSelect = {
  id: true,
  toEmail: true,
  status: true,
  scheduledAt: true,
  sentAt: true,
  previewUrl: true,
  error: true,
  campaign: { select: { subject: true } },
  sender: { select: { email: true } },
} satisfies Prisma.EmailSelect;
const toItem = ({ campaign, sender, ...r }: Prisma.EmailGetPayload<{ select: typeof rowSelect }>) => ({ ...r, subject: campaign.subject, from: sender.email });

// Tabs read Postgres: always exact, even if Elasticsearch is behind or down.
emailsRouter.get('/', async (req, res) => {
  const tab = req.query.tab === 'sent' ? 'sent' : 'scheduled';
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const rows = await prisma.email.findMany({
    where: { userId: req.userId, status: { in: TABS[tab] } },
    orderBy: tab === 'scheduled' ? [{ scheduledAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: PAGE + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select: rowSelect,
  });
  const items = rows.slice(0, PAGE).map(toItem);
  res.json({ items, nextCursor: rows.length > PAGE ? items[items.length - 1].id : null });
});

const SearchQuery = z.object({ q: z.string().trim().min(1).max(200), status: z.enum(EmailStatus).optional() });

// Search box: ES finds and ranks the ids, Postgres shows the rows, so statuses are never stale.
emailsRouter.get('/search', async (req, res) => {
  const { q, status } = SearchQuery.parse(req.query);
  const ids = await searchEmailIds(req.userId!, q, status).catch((err) => {
    console.error('search failed:', err.message);
    throw new HttpError(503, 'Search is unavailable right now. The tabs still work.');
  });
  // userId and status are checked again here: ES is only a copy and may be a second behind.
  const rows = await prisma.email.findMany({ where: { id: { in: ids }, userId: req.userId, ...(status && { status }) }, select: rowSelect });
  const byId = new Map(rows.map((r) => [r.id, r]));
  res.json({ items: ids.flatMap((id) => (byId.has(id) ? [toItem(byId.get(id)!)] : [])) }); // keep ES's ranking
});

emailsRouter.get('/:id/events', async (req, res) => {
  const events = await prisma.auditEvent.findMany({
    where: { emailId: req.params.id, userId: req.userId },
    orderBy: { id: 'asc' },
  });
  res.json({ items: events.map((e) => ({ ...e, id: e.id.toString() })) }); // BigInt isn't JSON-serialisable
});

// "Retry send". force: send again even when the mailbox check can't tell whether the first try went out (the UI asks first).
const RetryBody = z.object({ force: z.boolean().optional() });

emailsRouter.post('/:id/retry', async (req, res) => {
  const { force } = RetryBody.parse(req.body ?? {});
  res.json(await retryEmail(req.userId!, req.params.id, force));
});
