import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { devLogin, env } from './config/env';
import { prisma } from './lib/db';
import { errorFields, log } from './lib/log';
import { HttpError } from './utils/errors';
import { originCheck } from './middleware/originCheck';
import { allQueues } from './lib/queues';
import { authRouter } from './routes/auth';
import { campaignsRouter } from './routes/campaigns';
import { emailsRouter } from './routes/emails';
import { sendersRouter } from './routes/senders';
import { slackRouter } from './routes/slack';
import { per } from './services/slack';
import { isAdminEmail, requireAdmin, requireAuth } from './middleware/requireAuth';

function bullBoard() {
  const adapter = new ExpressAdapter();
  adapter.setBasePath('/admin/queues');
  // Read-only: retries/deletes must go through our audited API instead.
  createBullBoard({ queues: allQueues.map((q) => new BullMQAdapter(q, { readOnlyMode: true })), serverAdapter: adapter });
  return adapter.getRouter();
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' })); // ~10k leads, or 2 MB of attachments sent as base64
  app.use(cookieParser());
  // One line per write, error or slow request. Fast, successful reads (the dashboard polls every 5s) and "not signed in"
  // checks are skipped. originalUrl, because routers trim req.path; without the query string, which can hold OAuth codes.
  app.use((req, res, next) => {
    const start = performance.now();
    res.on('finish', () => {
      const ms = Math.round(performance.now() - start);
      const quiet = req.method === 'GET' && ms < 1000 && (res.statusCode < 400 || res.statusCode === 401);
      if (quiet) return;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log[level](`${req.method} ${req.originalUrl.split('?')[0]}`, { status: res.statusCode, ms, userId: req.userId });
    });
    next();
  });
  app.use(originCheck);

  app.get('/api/health', (_req, res) => {
    // devLogin: the login page shows the dev button only when on. limitWindow: "hour", or "minute" in the demo setup.
    res.json({ ok: true, devLogin, limitWindow: per(env.RATE_LIMIT_WINDOW_MS) });
  });
  app.get('/api/me', requireAuth, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, email: true, avatarUrl: true } });
    if (!user) throw new HttpError(401, 'unauthenticated');
    res.json({ ...user, isAdmin: isAdminEmail(user.email) }); // the menu shows the queue dashboard link to admins only
  });
  app.use('/auth', authRouter);

  app.use('/api/senders', requireAuth, sendersRouter);
  app.use('/api/campaigns', requireAuth, campaignsRouter);
  app.use('/api/emails', requireAuth, emailsRouter);
  app.use('/api/slack', requireAuth, slackRouter);
  app.use('/admin/queues', requireAuth, requireAdmin, bullBoard()); // shows every user's jobs, so admins only

  app.use((err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, ...(err.code && { code: err.code }) });
    if (err instanceof z.ZodError) return void res.status(400).json({ error: 'Invalid input', issues: err.issues });
    if (err.status && err.status < 500) return void res.status(err.status).json({ error: err.message }); // e.g. bad JSON
    log.error('request failed', { method: req.method, path: req.originalUrl.split('?')[0], userId: req.userId, ...errorFields(err), stack: err.stack });
    res.status(500).json({ error: 'Internal error' });
  });
  return app;
}
