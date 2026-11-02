import crypto from 'node:crypto';
import { Router } from 'express';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { devLogin, env } from '../config/env';
import { prisma } from '../lib/db';
import { audit } from '../services/emails';
import { cookieName, cookieOpts, createSession, destroySession, sessionUser } from '../services/session';

export const authRouter = Router();

// Every redirect is built from APP_URL, never from the Host header (behind a proxy it can be the internal address).
const google = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, `${env.APP_URL}/auth/google/callback`);
const OAUTH = cookieName('g_oauth'); // { state, codeVerifier } for the 10 minutes of one login

authRouter.get('/google', async (_req, res) => {
  if (!env.GOOGLE_CLIENT_ID) return res.redirect(`${env.APP_URL}/login?error=not_configured`);
  const state = crypto.randomBytes(32).toString('base64url');
  const { codeVerifier, codeChallenge } = await google.generateCodeVerifierAsync();
  res.cookie(OAUTH, JSON.stringify({ state, codeVerifier }), { ...cookieOpts, maxAge: 600_000 });
  res.redirect(
    google.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    }),
  );
});

authRouter.get('/google/callback', async (req, res) => {
  const fail = (why: string) => res.redirect(`${env.APP_URL}/login?error=${why}`);
  let saved: { state?: string; codeVerifier?: string } | null = null;
  try {
    saved = JSON.parse(req.cookies?.[OAUTH] ?? 'null');
  } catch {
    // tampered cookie: treated like a missing one
  }
  res.clearCookie(OAUTH, cookieOpts); // single use, whatever happens next
  if (req.query.error) return fail('cancelled');
  if (!saved?.state || typeof req.query.state !== 'string' || req.query.state !== saved.state) return fail('state');

  try {
    const { tokens } = await google.getToken({ code: String(req.query.code), codeVerifier: saved.codeVerifier });
    const ticket = await google.verifyIdToken({ idToken: tokens.id_token!, audience: env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.email || !p.email_verified) return fail('unverified');
    const profile = { email: p.email, name: p.name ?? p.email, avatarUrl: p.picture ?? null };
    const user = await prisma.user.upsert({ where: { googleId: p.sub }, create: { googleId: p.sub, ...profile }, update: profile });
    await createSession(res, user.id);
    await audit({ userId: user.id, type: 'login', actor: `user:${user.id}` });
    res.redirect(`${env.APP_URL}/dashboard`);
  } catch (err) {
    console.error('google login failed:', (err as Error).message);
    fail('google');
  }
});

// Dev only (DEV_LOGIN=true, never in production): try the app before the Google OAuth client exists.
authRouter.get('/dev', async (_req, res) => {
  if (!devLogin) return void res.status(404).json({ error: 'Not found' });
  const email = 'dev@example.com';
  const user = await prisma.user.upsert({ where: { googleId: `dev:${email}` }, create: { googleId: `dev:${email}`, email, name: 'Dev User' }, update: {} });
  await createSession(res, user.id);
  res.redirect(`${env.APP_URL}/dashboard`);
});

authRouter.post('/logout', async (req, res) => {
  const userId = await sessionUser(req);
  await destroySession(req, res);
  if (userId) await audit({ userId, type: 'logout', actor: `user:${userId}` });
  res.json({ ok: true });
});
