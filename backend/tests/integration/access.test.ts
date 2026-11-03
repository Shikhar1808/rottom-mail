// Who can see what, through the real app on a free port. Needs Postgres and Redis from `docker compose up`.
// Rows are deleted afterwards; the one audit event stays, because the audit table is append-only.
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { alice, bob } = vi.hoisted(() => {
  const [alice, bob] = [globalThis.crypto.randomUUID(), globalThis.crypto.randomUUID()];
  process.env.ADMIN_EMAILS = `someone@else.test, ${alice}@Test.Local`; // spaces and case differ on purpose
  return { alice, bob };
});

import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { prisma } from '../../src/lib/db';
import { redis } from '../../src/lib/redis';
import { newSession, SID } from '../../src/services/session';

const sids: string[] = [];
let server: Server;
let base = '';
let bobsEmail = '';

const login = async (userId: string) => {
  const sid = await newSession(userId);
  sids.push(sid);
  return `${SID}=${sid}`;
};
const get = (path: string, cookie = '') => fetch(base + path, { headers: { cookie } });
const items = async (path: string, cookie: string) => ((await (await get(path, cookie)).json()) as { items: { id: string; preview?: string }[] }).items;

beforeAll(async () => {
  server = createApp().listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const id of [alice, bob]) await prisma.user.create({ data: { id, googleId: `test:${id}`, email: `${id}@test.local`, name: 'Test' } });
  const sender = await prisma.sender.create({
    data: { userId: bob, email: `${bob}@sender.test`, smtpUser: 'x', smtpPassEnc: 'x', smtpHost: 'x', smtpPort: 587, imapHost: 'x', imapPort: 993 },
  });
  const campaign = await prisma.campaign.create({ data: { userId: bob, senderId: sender.id, subject: 's', body: 'b', startAt: new Date(), delayMs: 0, hourlyLimit: 10 } });
  const email = await prisma.email.create({
    data: { campaignId: campaign.id, userId: bob, senderId: sender.id, toEmail: 'lead@test.local', scheduledAt: new Date(), status: 'failed' },
  });
  bobsEmail = email.id;
  await prisma.auditEvent.create({ data: { userId: bob, campaignId: campaign.id, emailId: email.id, type: 'failed', actor: 'worker:test' } });
});
afterAll(async () => {
  server?.close();
  await prisma.email.deleteMany({ where: { userId: bob } });
  await prisma.campaign.deleteMany({ where: { userId: bob } });
  await prisma.sender.deleteMany({ where: { userId: bob } });
  await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } });
  if (sids.length) await redis.del(...sids.map((s) => `sess:${s}`));
  await redis.quit();
  await prisma.$disconnect();
});

it('only users in ADMIN_EMAILS can open the queue dashboard', async () => {
  expect((await get('/admin/queues')).status).toBe(401);
  expect((await get('/admin/queues', await login(bob))).status).toBe(403);
  expect((await get('/admin/queues', await login(alice))).status).toBe(200);
});

describe("a user can't see or touch another user's emails", () => {
  it('list and history', async () => {
    const [asBob, asAlice] = [await login(bob), await login(alice)];
    expect((await items('/api/emails?tab=sent', asBob)).find((e) => e.id === bobsEmail)).toMatchObject({ preview: 'b' }); // so the checks below aren't empty by accident
    expect((await items('/api/emails?tab=sent', asAlice)).map((e) => e.id)).not.toContain(bobsEmail);
    expect(await items(`/api/emails/${bobsEmail}/events`, asBob)).toHaveLength(1);
    expect(await items(`/api/emails/${bobsEmail}/events`, asAlice)).toHaveLength(0);
  });

  it('email page and sidebar counts', async () => {
    const [asBob, asAlice] = [await login(bob), await login(alice)];
    expect(await (await get(`/api/emails/${bobsEmail}`, asBob)).json()).toMatchObject({ id: bobsEmail, body: 'b', status: 'failed' });
    expect((await get(`/api/emails/${bobsEmail}`, asAlice)).status).toBe(404);
    expect(await (await get('/api/emails/counts', asBob)).json()).toEqual({ scheduled: 0, sent: 1 });
    expect(await (await get('/api/emails/counts', asAlice)).json()).toEqual({ scheduled: 0, sent: 0 });
  });

  it('retry, and the request log names the full path', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined); // warnings go to stderr
    const res = await fetch(`${base}/api/emails/${bobsEmail}/retry`, {
      method: 'POST',
      headers: { cookie: await login(alice), origin: new URL(env.APP_URL).origin, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
    expect((await prisma.email.findUniqueOrThrow({ where: { id: bobsEmail } })).status).toBe('failed');
    // Answered inside the /api/emails mount (no session → 401), where Express has trimmed req.path to "/<id>/retry".
    await fetch(`${base}/api/emails/${bobsEmail}/retry`, { method: 'POST', headers: { origin: new URL(env.APP_URL).origin, 'content-type': 'application/json' }, body: '{}' });
    await new Promise((r) => setTimeout(r, 50)); // the log line is written when the response finishes
    expect(logged.mock.calls.flat().join(' ')).toContain(`POST /api/emails/${bobsEmail}/retry status=401`);
    logged.mockRestore();
  });
});
