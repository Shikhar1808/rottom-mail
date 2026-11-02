// Needs Postgres + Elasticsearch from `docker compose up`. Uses throwaway users; their rows and ES docs are removed after.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../queues', () => ({ searchSyncQueue: { add: async () => undefined } }));

import { prisma } from '../db';
import { updateEmail } from './emails';
import { es, searchEmailIds, syncEmails } from './search';

const tag = () => crypto.randomBytes(6).toString('hex'); // one searchable word per lead
const users = [crypto.randomUUID(), crypto.randomUUID()];
const leads = [tag(), tag()];
const emailIds: string[] = [];

beforeAll(async () => {
  for (const [i, userId] of users.entries()) {
    const senderId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await prisma.user.create({ data: { id: userId, googleId: `test:${userId}`, email: `u${i}@test.local`, name: 'Test' } });
    await prisma.sender.create({
      data: { id: senderId, userId, email: `${senderId}@test.local`, smtpUser: 'x', smtpPassEnc: 'x', smtpHost: 'x', smtpPort: 587, imapHost: 'x', imapPort: 993 },
    });
    await prisma.campaign.create({ data: { id: campaignId, userId, senderId, subject: 'Search test', body: 'b', startAt: new Date(), delayMs: 0, hourlyLimit: 10 } });
    const e = await prisma.email.create({ data: { campaignId, userId, senderId, toEmail: `${leads[i]}@search.test`, scheduledAt: new Date() } });
    emailIds.push(e.id);
  }
});

afterAll(async () => {
  await es.deleteByQuery({ index: 'emails', query: { terms: { userId: users } }, refresh: true });
  await prisma.email.deleteMany({ where: { userId: { in: users } } });
  await prisma.campaign.deleteMany({ where: { userId: { in: users } } });
  await prisma.sender.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe('search', () => {
  it('syncs safely (repeats and late old copies lose) and only finds the caller’s own emails', async () => {
    const [mine, theirs] = emailIds;
    await syncEmails(emailIds);
    await syncEmails([mine]); // the same version again: ES answers 409, which counts as done

    await updateEmail(mine, { status: 'failed' }, { userId: users[0], type: 'test', actor: 'test' }, ['scheduled']); // version 2
    await syncEmails([mine]);
    const late = await es
      .index({ index: 'emails', id: mine, version: 1, version_type: 'external', document: { status: 'scheduled' } })
      .catch((e) => e.meta.statusCode);
    expect(late).toBe(409); // an old copy arriving late can't overwrite the newer one
    expect((await es.get<{ status: string }>({ index: 'emails', id: mine }))._source?.status).toBe('failed');

    const rows = await prisma.email.findMany({ where: { id: { in: emailIds } } });
    expect(rows.every((r) => r.indexedVersion === r.version)).toBe(true);

    await es.indices.refresh({ index: 'emails' });
    expect(await searchEmailIds(users[0], leads[0])).toEqual([mine]);
    expect(await searchEmailIds(users[0], leads[1])).toEqual([]); // someone else's lead
    expect(await searchEmailIds(users[1], leads[1])).toEqual([theirs]);
  });
});
