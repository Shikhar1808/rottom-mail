import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { encrypt } from '../utils/crypto';
import { prisma } from '../lib/db';
import { HttpError } from '../utils/errors';
import { sleep } from '../utils/helpers';
import { redis } from '../lib/redis';
import { audit } from './emails';

// Never select the encrypted password into API responses.
const publicFields = { id: true, email: true, status: true, createdAt: true } as const;

const activeSenders = (userId: string) =>
  prisma.sender.findMany({ where: { userId, status: 'active' }, select: publicFields, orderBy: { createdAt: 'asc' } });

async function createSender(userId: string) {
  const acc = await nodemailer.createTestAccount();
  const sender = await prisma.sender.create({
    data: {
      userId,
      email: acc.user,
      smtpUser: acc.user,
      smtpPassEnc: encrypt(acc.pass),
      smtpHost: acc.smtp.host,
      smtpPort: acc.smtp.port,
      imapHost: acc.imap.host,
      imapPort: acc.imap.port,
    },
    select: publicFields,
  });
  await audit({ userId, type: 'sender_created', actor: `user:${userId}`, data: { email: sender.email } });
  return sender;
}

/** Option B: the first time a user has no working sender, create DEFAULT_SENDERS_PER_USER Ethereal mailboxes. */
export async function listOrProvisionSenders(userId: string) {
  const existing = await activeSenders(userId);
  if (existing.length) return existing;

  const lock = `provision:${userId}`;
  if (await redis.set(lock, '1', 'EX', 30, 'NX')) {
    try {
      for (let i = 0; i < env.DEFAULT_SENDERS_PER_USER; i++) await createSender(userId);
    } finally {
      await redis.del(lock);
    }
    return activeSenders(userId);
  }
  // Another request (e.g. a second tab) is creating them: wait for it.
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const senders = await activeSenders(userId);
    if (senders.length) return senders;
  }
  throw new HttpError(503, 'Sender setup is taking too long, try again');
}

export async function addSender(userId: string) {
  const count = await prisma.sender.count({ where: { userId, status: 'active' } });
  if (count >= env.MAX_SENDERS_PER_USER) throw new HttpError(409, `You can have at most ${env.MAX_SENDERS_PER_USER} senders`);
  return createSender(userId);
}
