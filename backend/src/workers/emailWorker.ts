import os from 'node:os';
import { DelayedError, type Job, UnrecoverableError } from 'bullmq';
import nodemailer from 'nodemailer';
import type { Prisma } from '@prisma/client';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { prisma } from '../lib/db';
import { errorFields, log } from '../lib/log';
import type { EmailJob } from '../lib/queues';
import { messageIdFor, transportFor } from '../services/mailer';
import { audit, checkDelivery, type Ev, markFoundSent, updateEmail } from '../services/emails';
import { gate, nextWindow, sleepUntil } from '../services/limiter';

const LOCK_MS = 30_000; // BullMQ's default lock; a claim younger than this may still be in progress
const actor = `worker:${os.hostname()}:${process.pid}`;

type LoadedEmail = Prisma.EmailGetPayload<{ include: { campaign: true; sender: true } }>;
type SmtpError = Error & { responseCode?: number; code?: string };

export async function processEmail(job: Job<EmailJob>, token?: string) {
  const email = await prisma.email.findUnique({ where: { id: job.data.emailId }, include: { campaign: true, sender: true } });
  if (!email) return;
  const ev: Ev = (type, data) => ({
    userId: email.userId,
    campaignId: email.campaignId,
    type,
    actor,
    attempt: job.attemptsMade + 1,
    data,
  });

  if (email.status === 'sending') return recoverAfterCrash(job, token, email, ev);
  if (email.status !== 'scheduled') return; // already sent / failed / parked: nothing to do

  await gate(job, token, email, ev); // rate limits: returns when it's this email's turn, else moves the job and throws
  const attachments = await attachmentsFor(email.campaignId); // before the claim: a database error here is a plain retry

  // Atomic claim: of any number of workers, exactly one moves the row from scheduled to sending.
  const claimed = await updateEmail(email.id, { status: 'sending', claimedAt: new Date(), attempts: { increment: 1 } }, ev('claimed'), ['scheduled']);
  if (!claimed) {
    log.info('email already claimed by another worker, skipped', { emailId: email.id });
    await audit({ ...ev('skipped_duplicate'), emailId: email.id });
    return;
  }

  let info: { messageId: string; response?: string };
  const started = performance.now();
  try {
    info = await transportFor(email.sender).sendMail({
      from: email.sender.email,
      to: email.toEmail,
      subject: email.campaign.subject,
      text: email.campaign.body,
      html: email.campaign.html ?? undefined,
      attachments,
      messageId: messageIdFor(email.id), // fixed id: lets the delivery check find it in the mailbox later
    });
  } catch (err) {
    return handleSendError(job, token, email, err as SmtpError, ev);
  }

  log.info('email sent', { emailId: email.id, campaignId: email.campaignId, sender: email.sender.email, attempt: job.attemptsMade + 1, ms: Math.round(performance.now() - started), reply: info.response?.slice(0, 80) });
  // If this write fails the row stays "sending": the retry goes through recoverAfterCrash, never a blind resend.
  const previewUrl = nodemailer.getTestMessageUrl(info as SMTPTransport.SentMessageInfo) || null;
  const sent = { status: 'sent' as const, sentAt: new Date(), messageId: info.messageId, previewUrl, error: null };
  const event = ev('sent', { smtpResponse: info.response ?? 'fake transport', messageId: info.messageId, previewUrl });
  // A slow send may have been parked as needs_check by another copy of this job. It did go out, so record it.
  if (!(await updateEmail(email.id, sent, event, ['sending']))) await updateEmail(email.id, sent, event, ['needs_check']);
}

// shortcut: reads the campaign's files (2 MB at most) for every email; cache them per campaign if attachments ever get big.
async function attachmentsFor(campaignId: string) {
  const files = await prisma.attachment.findMany({ where: { campaignId }, select: { filename: true, contentType: true, data: true }, orderBy: { createdAt: 'asc' } });
  return files.map((f) => ({ filename: f.filename, contentType: f.contentType, content: Buffer.from(f.data) }));
}

async function handleSendError(job: Job<EmailJob>, token: string | undefined, email: LoadedEmail, err: SmtpError, ev: Ev) {
  const code = err.responseCode;
  const error = String(err.message).slice(0, 500);
  const where = { emailId: email.id, sender: email.sender.email, ...errorFields(err) };
  const fail = (reason: string) =>
    updateEmail(email.id, { status: 'failed', error: reason }, ev('failed', { error, code: code ?? err.code ?? null }), ['sending']);

  if (code === 535 || err.code === 'EAUTH') {
    log.error('email failed: sender login rejected, sender marked broken', where);
    await prisma.sender.update({ where: { id: email.senderId }, data: { status: 'broken' } });
    await audit({ ...ev('sender_broken', { sender: email.sender.email, error }) });
    await fail(`Sender login failed: ${error}`);
    throw new UnrecoverableError(error);
  }
  if (code && code >= 500) {
    log.warn('email failed: mail server rejected it', where);
    await fail(error); // permanent SMTP rejection
    throw new UnrecoverableError(error);
  }
  if (!code) {
    // No SMTP reply: the connection may have dropped after the server took the message, so a resend could duplicate it.
    // shortcut: parked without a mailbox check; the check runs when the user clicks Retry send. Add a delayed automatic check if these pile up.
    log.warn('email needs check: no SMTP reply, so it may or may not have gone out', where);
    await updateEmail(email.id, { status: 'needs_check', error }, ev('needs_check', { reason: 'no SMTP reply', error, code: err.code ?? null }), ['sending']);
    throw new UnrecoverableError(error);
  }
  // 4xx is temporary (e.g. Ethereal's 200/hour): move to the next window without using an attempt.
  // shortcut: a 4xx that never clears keeps moving one window at a time; add a max-deferrals cap if that shows up.
  const until = nextWindow();
  log.warn('email deferred: mail server said try later', { ...where, newTime: new Date(until).toISOString() });
  await updateEmail(email.id, { status: 'scheduled', scheduledAt: new Date(until), error }, ev('smtp_deferred', { error, code, newTime: new Date(until).toISOString() }), ['sending']);
  throw await sleepUntil(job, token, until);
}

async function recoverAfterCrash(job: Job<EmailJob>, token: string | undefined, email: LoadedEmail, ev: Ev) {
  if (Date.now() - (email.claimedAt?.getTime() ?? 0) < LOCK_MS) {
    await job.moveToDelayed(Date.now() + LOCK_MS, token); // the claiming worker may still be mid-send
    throw new DelayedError();
  }
  // The worker that claimed it died mid-send. Look in the mailbox before deciding (Option C, docs/03).
  const check = await checkDelivery(email);
  log.warn('recovering an email interrupted mid-send', { emailId: email.id, check: check.result, reason: check.reason });
  if (check.result === 'found') {
    await markFoundSent(email, ev('delivery_checked', check), 'sending');
  } else if (check.result === 'not_found') {
    // It never left: put it back and send it now, through the limiter and the claim like any other email.
    if (await updateEmail(email.id, { status: 'scheduled' }, ev('delivery_checked', check), ['sending'])) await processEmail(job, token);
  } else {
    const error = `Worker stopped mid-send. ${check.reason}`;
    await updateEmail(email.id, { status: 'needs_check', error }, ev('needs_check', { reason: 'interrupted while sending', check: check.reason }), ['sending']);
  }
}
