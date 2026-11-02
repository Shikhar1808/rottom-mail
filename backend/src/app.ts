import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { devLogin } from './config/env';
import { prisma } from './lib/db';
import { HttpError } from './utils/errors';
import { originCheck } from './middleware/originCheck';
import { allQueues } from './lib/queues';
import { authRouter } from './routes/auth';
import { campaignsRouter } from './routes/campaigns';
import { emailsRouter } from './routes/emails';
import { sendersRouter } from './routes/senders';
import { slackRouter } from './routes/slack';
import { requireAuth } from './middleware/requireAuth';

function bullBoard() {
  const adapter = new ExpressAdapter();
  adapter.setBasePath('/admin/queues');
  // Read-only: retries/deletes must go through our audited API instead.
  createBullBoard({ queues: allQueues.map((q) => new BullMQAdapter(q, { readOnlyMode: true })), serverAdapter: adapter });
  return adapter.getRouter();
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' })); // ~10k leads
  app.use(cookieParser());
  app.use(originCheck);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, devLogin }); // the login page shows the dev button only when this is on
  });
  app.get('/api/me', requireAuth, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, email: true, avatarUrl: true } });
    if (!user) throw new HttpError(401, 'unauthenticated');
    res.json(user);
  });
  app.use('/auth', authRouter);

  app.use('/api/senders', requireAuth, sendersRouter);
  app.use('/api/campaigns', requireAuth, campaignsRouter);
  app.use('/api/emails', requireAuth, emailsRouter);
  app.use('/api/slack', requireAuth, slackRouter);
  app.use('/admin/queues', requireAuth, bullBoard());

  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return void res.status(400).json({ error: 'Invalid input', issues: err.issues });
    if (err.status && err.status < 500) return void res.status(err.status).json({ error: err.message }); // e.g. bad JSON
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });
  return app;
}
