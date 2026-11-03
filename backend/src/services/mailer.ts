import { ImapFlow } from 'imapflow';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Sender } from '@prisma/client';
import { env } from '../config/env';
import { decrypt } from '../utils/crypto';

const pools = new Map<string, Transporter>();
let fake: Transporter | undefined;

// One pooled SMTP connection set per sender, reused for every email from it.
export function transportFor(sender: Sender): Transporter {
  if (env.SMTP_MODE === 'fake') return (fake ??= nodemailer.createTransport({ jsonTransport: true }));
  let t = pools.get(sender.id);
  if (!t) {
    t = nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: sender.smtpPort === 465,
      auth: { user: sender.smtpUser, pass: decrypt(sender.smtpPassEnc) },
      pool: true,
      maxConnections: 2,
    });
    pools.set(sender.id, t);
  }
  return t;
}

export function closeTransports() {
  for (const t of pools.values()) t.close();
  pools.clear();
}

/** Fixed per email, so the delivery check can find it in the mailbox later. */
export const messageIdFor = (emailId: string) => `<${emailId}@reachinbox.local>`;

/**
 * Is a message with this Message-ID in the sender's mailbox? Ethereal keeps sent mail in INBOX (live-tested, docs/references.md).
 * Throws when it can't tell, so a failed check is never read as "not sent".
 */
export async function findInMailbox(sender: Sender, messageId: string): Promise<boolean> {
  if (env.SMTP_MODE === 'fake') throw new Error('fake SMTP mode has no mailbox');
  const client = new ImapFlow({
    host: sender.imapHost,
    port: sender.imapPort,
    secure: sender.imapPort === 993,
    auth: { user: sender.smtpUser, pass: decrypt(sender.smtpPassEnc) },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  client.on('error', () => undefined); // the awaited calls below reject as well; an unheard 'error' event would crash the process
  await client.connect();
  try {
    await client.mailboxOpen('INBOX', { readOnly: true });
    const hits = await client.search({ header: { 'message-id': messageId } });
    if (!Array.isArray(hits)) throw new Error('the mail server rejected the search');
    return hits.length > 0;
  } finally {
    await client.logout().catch(() => client.close());
  }
}
