import crypto from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { isHttps } from '../config/env';
import { redis } from '../lib/redis';

const TTL_SECONDS = 7 * 24 * 3600;

// __Host- cookies can't be planted by sibling subdomains; browsers only allow them over https.
export const cookieName = (name: string) => (isHttps ? `__Host-${name}` : name);
export const cookieOpts: CookieOptions = { httpOnly: true, secure: isHttps, sameSite: 'lax', path: '/' };
export const SID = cookieName('sid');

export async function newSession(userId: string): Promise<string> {
  const sid = crypto.randomBytes(32).toString('base64url');
  await redis.set(`sess:${sid}`, userId, 'EX', TTL_SECONDS);
  return sid;
}

export async function createSession(res: Response, userId: string) {
  res.cookie(SID, await newSession(userId), { ...cookieOpts, maxAge: TTL_SECONDS * 1000 });
}

/** The user id behind this request's session cookie, or null. */
export async function sessionUser(req: Request): Promise<string | null> {
  const sid = req.cookies?.[SID];
  return sid ? redis.get(`sess:${sid}`) : null;
}

export async function destroySession(req: Request, res: Response) {
  const sid = req.cookies?.[SID];
  if (sid) await redis.del(`sess:${sid}`);
  res.clearCookie(SID, cookieOpts);
}
