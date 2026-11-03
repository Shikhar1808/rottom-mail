import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/db';
import { sessionUser } from '../services/session';

/** Lets the request through only with a live session, and sets req.userId for the routes. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = await sessionUser(req);
  if (!userId) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  req.userId = userId;
  next();
}

// The email is safe to trust: login only accepts verified Google emails.
export const isAdminEmail = (email: string) => env.ADMIN_EMAILS.includes(email.toLowerCase());

/** After requireAuth: only users listed in ADMIN_EMAILS. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
  if (!user || !isAdminEmail(user.email)) {
    res.status(403).json({ error: 'Only admins can open the queue dashboard' });
    return;
  }
  next();
}
