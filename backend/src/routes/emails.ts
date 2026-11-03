import { Router } from 'express';
import { EmailStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { HttpError } from '../utils/errors';
import { errorFields, log } from '../lib/log';
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
  campaignId: true,
  toEmail: true,
  status: true,
  scheduledAt: true,
  sentAt: true,
  previewUrl: true,
  error: true,
  campaign: { select: { subject: true } },
  sender: { select: { email: true } },
} satisfies Prisma.EmailSelect;
type Row = Prisma.EmailGetPayload<{ select: typeof rowSelect }>;
const toItem = ({ campaign, sender, ...r }: Row) => ({ ...r, subject: campaign.subject, from: sender.email });

/** List rows plus the start of the message, like an inbox. One query for the few campaigns on a page. */
async function withPreview(rows: Row[]) {
  const ids = [...new Set(rows.map((r) => r.campaignId))];
  const campaigns = await prisma.$queryRaw<{ id: string; body: string }[]>`SELECT id, left(body, 400) AS body FROM "Campaign" WHERE id = ANY(${ids}::text[])`;
  const preview = new Map(campaigns.map((c) => [c.id, c.body.replace(/\s+/g, ' ').trim().slice(0, 160)]));
  return rows.map((r) => ({ ...toItem(r), preview: preview.get(r.campaignId) ?? '' }));
}

// Tabs read Postgres: always exact, even if Elasticsearch is behind or down.
emailsRouter.get('/', async (req, res) => {
  const tab = req.query.tab === 'sent' ? 'sent' : 'scheduled';
  // Optional filter inside the tab, e.g. only the failed ones in Sent.
  const only = TABS[tab].find((s) => s === req.query.status);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const rows = await prisma.email.findMany({
    where: { userId: req.userId, status: { in: only ? [only] : TABS[tab] } },
    orderBy: tab === 'scheduled' ? [{ scheduledAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: PAGE + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select: rowSelect,
  });
  const items = await withPreview(rows.slice(0, PAGE));
  res.json({ items, nextCursor: rows.length > PAGE ? items[items.length - 1].id : null });
});

// Sidebar counts for the two tabs.
emailsRouter.get('/counts', async (req, res) => {
  const groups = await prisma.email.groupBy({ by: ['status'], where: { userId: req.userId }, _count: true });
  const count = (tab: keyof typeof TABS) => groups.reduce((n, g) => n + (TABS[tab].includes(g.status) ? g._count : 0), 0);
  res.json({ scheduled: count('scheduled'), sent: count('sent') });
});

const SearchQuery = z.object({ q: z.string().trim().min(1).max(200), status: z.enum(EmailStatus).optional() });

// Search box: ES finds and ranks the ids, Postgres shows the rows, so statuses are never stale.
emailsRouter.get('/search', async (req, res) => {
  const { q, status } = SearchQuery.parse(req.query);
  const ids = await searchEmailIds(req.userId!, q, status).catch((err) => {
    log.error('search failed', { userId: req.userId, ...errorFields(err) });
    throw new HttpError(503, 'Search is unavailable right now. The tabs still work.');
  });
  // userId and status are checked again here: ES is only a copy and may be a second behind.
  const rows = await prisma.email.findMany({ where: { id: { in: ids }, userId: req.userId, ...(status && { status }) }, select: rowSelect });
  const byId = new Map(rows.map((r) => [r.id, r]));
  res.json({ items: await withPreview(ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))) }); // keep ES's ranking
});

// One email with its whole message, for the email page.
emailsRouter.get('/:id', async (req, res) => {
  const row = await prisma.email.findFirst({
    where: { id: req.params.id, userId: req.userId },
    select: {
      ...rowSelect,
      campaign: { select: { subject: true, body: true, html: true, attachments: { select: { id: true, filename: true, contentType: true, size: true } } } },
    },
  });
  if (!row) throw new HttpError(404, 'Email not found');
  const { body, html, attachments } = row.campaign;
  res.json({ ...toItem(row), body, html, attachments }); // file names and sizes only: Ethereal's preview has the files
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
