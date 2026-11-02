import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

const appOrigin = new URL(env.APP_URL).origin;

// CSRF guard on top of SameSite=Lax: state-changing requests must come from our own page.
export function originCheck(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get('origin') !== appOrigin) {
    res.status(403).json({ error: 'Request origin not allowed' });
    return;
  }
  next();
}
