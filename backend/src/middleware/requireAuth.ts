import type { NextFunction, Request, Response } from 'express';
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
