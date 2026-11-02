import os from 'node:os';
import { DelayedError, type Job, UnrecoverableError } from 'bullmq';
import nodemailer from 'nodemailer';
import type { Prisma } from '@prisma/client';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { prisma } from '../db';
import type { EmailJob } from '../queues';
import { transportFor } from '../services/mailer';
import { audit, type AuditInput, updateEmail } from '../services/emails';

const LOCK_MS = 30_000; // BullMQ's default lock; a claim younger than this may still be in progress
const actor = `worker:${os.hostname()}:${process.pid}`;

type LoadedEmail = Prisma.EmailGetPayload<{ include: { campaign: true; sender: true } }>;
type SmtpError = Error & { responseCode?: number; code?: string };

export async function processEmail(job: Job<EmailJob>, token?: string) {
  const email = await prisma.email.findUnique({ where: { id: job.data.emailId }, include: { campaign: true, sender: true } });
  if (!email) return;
  const ev = (type: string, data?: Prisma.InputJsonValue): AuditInput => ({
    userId: email.userId,
    campaignId: email.campaignId,
    type,
    actor,
    attempt: job.attemptsMade + 1,
    data,
  });

  if (email.status === 'sending') return recoverAfterCrash(job, token, email, ev);
  if (email.status !== 'scheduled') return; // already sent / failed / parked: nothing to do

  // Atomic claim: of any number of workers, exactly one moves the row from scheduled to sending.
  const claimed = await updateEmail(email.id, { status: 'sending', claimedAt: new Date(), attempts: { increment: 1 } }, ev('claimed'), ['scheduled']);
  if (!claimed) {
    await audit({ ...ev('skipped_duplicate'), emailId: email.id });
    return;
  }

  let info: { messageId: string; response?: string };
  try {
    info = await transportFor(email.sender).sendMail({
      from: email.sender.email,
      to: email.toEmail,
      subject: email.campaign.subject,
      text: email.campaign.body,
      messageId: `<${email.id}@reachinbox.local>`, // fixed id: lets a crash check find it at the server later
    });
  } catch (err) {
    return handleSendError(job, email, err as SmtpError, ev);
  }

  // If this write fails the row stays "sending": the retry goes through recoverAfterCrash, never a blind resend.
  const previewUrl = nodemailer.getTestMessageUrl(info as SMTPTransport.SentMessageInfo) || null;
  const sent = { status: 'sent' as const, sentAt: new Date(), messageId: info.messageId, previewUrl, error: null };
  const event = ev('sent', { smtpResponse: info.response ?? 'fake transport', messageId: info.messageId, previewUrl });
  // A slow send may have been parked as needs_check by another copy of this job. It did go out, so record it.
  if (!(await updateEmail(email.id, sent, event, ['sending']))) await updateEmail(email.id, sent, event, ['needs_check']);
}

async function handleSendError(job: Job<EmailJob>, email: LoadedEmail, err: SmtpError, ev: (t: string, d?: Prisma.InputJsonValue) => AuditInput) {
  const code = err.responseCode;
  const error = String(err.message).slice(0, 500);
  const fail = (reason: string) =>
    updateEmail(email.id, { status: 'failed', error: reason }, ev('failed', { error, code: code ?? err.code ?? null }), ['sending']);

  if (code === 535 || err.code === 'EAUTH') {
    await prisma.sender.update({ where: { id: email.senderId }, data: { status: 'broken' } });
    await audit({ ...ev('sender_broken', { sender: email.sender.email, error }) });
    await fail(`Sender login failed: ${error}`);
    throw new UnrecoverableError(error);
  }
  if (code && code >= 500) {
    await fail(error); // permanent SMTP rejection
    throw new UnrecoverableError(error);
  }
  if (!code) {
    // No SMTP reply: the connection may have dropped after the server took the message, so a resend could duplicate it.
    await updateEmail(email.id, { status: 'needs_check', error }, ev('needs_check', { reason: 'no SMTP reply', error, code: err.code ?? null }), ['sending']);
    throw new UnrecoverableError(error);
  }
  if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
    await fail(error); // out of retries: lands in BullMQ's failed set (the DLQ)
    throw err;
  }
  await updateEmail(email.id, { status: 'scheduled', error }, ev('send_failed', { error, code, willRetry: true }), ['sending']);
  throw err; // BullMQ retries with exponential backoff
}

async function recoverAfterCrash(job: Job<EmailJob>, token: string | undefined, email: LoadedEmail, ev: (t: string, d?: Prisma.InputJsonValue) => AuditInput) {
  if (Date.now() - (email.claimedAt?.getTime() ?? 0) < LOCK_MS) {
    await job.moveToDelayed(Date.now() + LOCK_MS, token); // the claiming worker may still be mid-send
    throw new DelayedError();
  }
  // shortcut: no IMAP Message-ID check yet (Option C, docs/03), so an interrupted send always waits for a manual Retry send; add the check in the P1 block.
  await updateEmail(email.id, { status: 'needs_check', error: 'Worker stopped mid-send; delivery unknown' }, ev('needs_check', { reason: 'interrupted while sending' }), ['sending']);
}
