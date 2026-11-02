// Needs Postgres and Redis from `docker compose up`. Runs the real app on a free port; Slack's token endpoint is stubbed.
import crypto from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SLACK_CLIENT_ID = 'test'; // so /api/slack/connect hands out a state instead of "not configured"
});

import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { prisma } from '../../src/lib/db';
import { notificationsQueue } from '../../src/lib/queues';
import { redis } from '../../src/lib/redis';
import { cookieName, newSession, SID } from '../../src/services/session';

const [alice, bob] = [crypto.randomUUID(), crypto.randomUUID()];
const sids: string[] = [];
const realFetch = globalThis.fetch;
// The app's only outgoing fetch here is Slack's oauth.v2.access.
const slack = vi.fn(async () =>
  Response.json({ ok: true, access_token: 'xoxp-test', team: { id: 'T1', name: 'Team' }, incoming_webhook: { url: 'https://hooks.slack.com/test', channel: '#alerts', channel_id: 'C1' } }),
);
let server: Server;
let base = '';

/** The redirect target of a GET, sent with the given cookie. */
const go = async (path: string, cookie: string) => (await realFetch(base + path, { headers: { cookie }, redirect: 'manual' })).headers.get('location');
const login = async (userId: string) => {
  const sid = await newSession(userId);
  sids.push(sid);
  return `${SID}=${sid}`;
};
const startSlack = async (cookie: string) => new URL((await go('/api/slack/connect', cookie))!).searchParams.get('state');

beforeAll(async () => {
  server = createApp().listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const id of [alice, bob]) await prisma.user.create({ data: { id, googleId: `test:${id}`, email: `${id}@test.local`, name: 'Test' } });
  vi.stubGlobal('fetch', slack);
  vi.spyOn(notificationsQueue, 'add').mockResolvedValue(undefined as never); // no real "connected" message
});
afterAll(async () => {
  vi.unstubAllGlobals();
  server?.close();
  await prisma.slackIntegration.deleteMany({ where: { userId: { in: [alice, bob] } } });
  await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } });
  if (sids.length) await redis.del(...sids.map((s) => `sess:${s}`));
  await redis.quit();
  await prisma.$disconnect();
});

describe('Slack callback state', () => {
  it("rejects a state another user started, and connects no one", async () => {
    const state = await startSlack(await login(alice));
    expect(await go(`/api/slack/callback?code=c&state=${state}`, await login(bob))).toBe(`${env.APP_URL}/dashboard?slack=error`);
    expect(slack).not.toHaveBeenCalled();
    expect(await prisma.slackIntegration.count({ where: { userId: { in: [alice, bob] } } })).toBe(0);
  });

  it('connects the user who started it, and only once', async () => {
    const cookie = await login(alice);
    const callback = `/api/slack/callback?code=c&state=${await startSlack(cookie)}`;
    expect(await go(callback, cookie)).toBe(`${env.APP_URL}/dashboard?slack=connected`);
    expect(await go(callback, cookie)).toBe(`${env.APP_URL}/dashboard?slack=error`); // replayed
    expect(slack).toHaveBeenCalledTimes(1);
    expect((await prisma.slackIntegration.findUnique({ where: { userId: alice } }))?.channel).toBe('#alerts');
  });
});

it('Google callback rejects a wrong or missing state', async () => {
  const saved = `${cookieName('g_oauth')}=${encodeURIComponent(JSON.stringify({ state: 'right', codeVerifier: 'v' }))}`;
  expect(await go('/auth/google/callback?code=c&state=wrong', saved)).toBe(`${env.APP_URL}/login?error=state`);
  expect(await go('/auth/google/callback?code=c&state=right', '')).toBe(`${env.APP_URL}/login?error=state`);
});
