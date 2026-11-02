import crypto from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env';
import { decrypt, encrypt } from '../utils/crypto';
import { prisma } from '../lib/db';
import { notificationsQueue } from '../lib/queues';
import { redis } from '../lib/redis';
import { audit } from '../services/emails';

export const slackRouter = Router();

type OAuthAccess = {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id: string; name: string };
  incoming_webhook?: { url: string; channel: string; channel_id: string };
};

// Status for the dashboard button. Never returns the webhook URL or the token.
slackRouter.get('/', async (req, res) => {
  const s = await prisma.slackIntegration.findUnique({
    where: { userId: req.userId },
    select: { status: true, teamName: true, channel: true, lastError: true, connectedAt: true },
  });
  res.json(s ? { connected: true, ...s } : { connected: false });
});

// Full-page navigation from the "Connect Slack" button.
slackRouter.get('/connect', async (req, res) => {
  if (!env.SLACK_CLIENT_ID) return res.redirect(`${env.APP_URL}/dashboard?slack=not_configured`);
  const state = crypto.randomBytes(32).toString('base64url');
  await redis.set(`slack_state:${state}`, req.userId!, 'EX', 600);
  res.redirect(
    'https://slack.com/oauth/v2/authorize?' +
      new URLSearchParams({ client_id: env.SLACK_CLIENT_ID, scope: 'incoming-webhook', state, redirect_uri: env.SLACK_REDIRECT_URI }),
  );
});

slackRouter.get('/callback', async (req, res) => {
  const back = (result: string) => res.redirect(`${env.APP_URL}/dashboard?slack=${result}`);
  const userId = req.userId!;
  // Single use, and it must belong to whoever is logged in: stops forged callbacks and someone attaching their channel to you.
  const owner = typeof req.query.state === 'string' ? await redis.getdel(`slack_state:${req.query.state}`) : null;
  if (req.query.error) return back('cancelled');
  if (owner !== userId) return back('error');

  try {
    const r = (await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code: String(req.query.code),
        redirect_uri: env.SLACK_REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(10_000),
    }).then((x) => x.json())) as OAuthAccess;
    if (!r.ok || !r.incoming_webhook || !r.team || !r.access_token) {
      console.error('slack connect failed:', r.error ?? 'no incoming_webhook in the reply');
      return back('error');
    }
    const data = {
      teamId: r.team.id,
      teamName: r.team.name,
      channel: r.incoming_webhook.channel,
      channelId: r.incoming_webhook.channel_id,
      webhookUrlEnc: encrypt(r.incoming_webhook.url),
      accessTokenEnc: encrypt(r.access_token),
      status: 'active' as const,
      lastError: null,
      connectedAt: new Date(),
    };
    // Reconnect replaces the webhook. The worker reads this row on every alert, so it takes effect at once.
    await prisma.slackIntegration.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await audit({ userId, type: 'slack_connected', actor: `user:${userId}`, data: { team: data.teamName, channel: data.channel } });
    await notificationsQueue.add('connected', { kind: 'connected', userId });
    back('connected');
  } catch (err) {
    console.error('slack connect failed:', (err as Error).message);
    back('error');
  }
});

slackRouter.delete('/', async (req, res) => {
  const userId = req.userId!;
  const s = await prisma.slackIntegration.findUnique({ where: { userId } });
  if (s) {
    const token = decrypt(s.accessTokenEnc);
    // Best effort: revoking the token at Slack also removes the webhook. The row is deleted either way.
    if (token) {
      await fetch('https://slack.com/api/auth.revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    }
    await prisma.slackIntegration.delete({ where: { userId } });
    await audit({ userId, type: 'slack_disconnected', actor: `user:${userId}`, data: { team: s.teamName, channel: s.channel } });
  }
  res.json({ ok: true });
});
