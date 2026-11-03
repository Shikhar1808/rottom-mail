import type { Email, EmailStatus, Prisma, Sender } from '@prisma/client';
import { prisma } from '../lib/db';
import { emailQueue, searchSyncQueue } from '../lib/queues';
import { HttpError } from '../utils/errors';
import { findInMailbox, messageIdFor } from './mailer';

export type AuditInput = {
  userId: string;
  campaignId?: string | null;
  emailId?: string | null;
  type: string;
  actor: string;
  attempt?: number;
  fromStatus?: string | null;
  toStatus?: string | null;
  data?: Prisma.InputJsonValue;
};

/** Builds an audit event for one email/job; the worker and the limiter each make one per job. */
export type Ev = (type: string, data?: Prisma.InputJsonValue) => AuditInput;

export function audit(event: AuditInput, db: Prisma.TransactionClient = prisma) {
  return db.auditEvent.create({ data: event });
}

/**
 * The only way an email row changes. The row update (+ version bump) and its audit event commit together,
 * then an ES sync job is queued. If queueing fails, version > indexedVersion and startup repair catches up.
 * `onlyFrom` makes it a conditional update: returns false (and writes nothing) if the row isn't in one of those states.
 */
export async function updateEmail(
  id: string,
  change: Prisma.EmailUpdateManyMutationInput & { status?: EmailStatus },
  event: AuditInput,
  onlyFrom?: EmailStatus[],
): Promise<boolean> {
  const ok = await prisma.$transaction(async (tx) => {
    const { count } = await tx.email.updateMany({
      where: { id, ...(onlyFrom && { status: { in: onlyFrom } }) },
      data: { ...change, version: { increment: 1 } },
    });
    if (count === 0) return false;
    await audit(
      {
        ...event,
        emailId: id,
        fromStatus: event.fromStatus ?? (onlyFrom?.length === 1 ? onlyFrom[0] : null),
        toStatus: change.status ?? null,
      },
      tx,
    );
    return true;
  });
  if (ok) await searchSyncQueue.add('email', { emailId: id });
  return ok;
}

// Ethereal deletes messages after "a few hours" (docs/references.md), so "not in the mailbox" only proves "never sent" for a recent attempt.
const TRUST_NOT_FOUND_MS = 3_600_000;

export type DeliveryCheck = { result: 'found' | 'not_found' | 'unknown'; reason: string };

/** Option C (docs/03): did an attempt whose outcome we never saw go out? Looks for the email's fixed Message-ID in its sender's mailbox. */
export async function checkDelivery(email: Email & { sender: Sender }): Promise<DeliveryCheck> {
  try {
    if (await findInMailbox(email.sender, messageIdFor(email.id))) return { result: 'found', reason: 'Found in the sending mailbox' };
  } catch (err) {
    const why = (err as { responseText?: string }).responseText || (err as Error).message;
    return { result: 'unknown', reason: `Couldn't check the sending mailbox (${why})` };
  }
  if (Date.now() - (email.claimedAt?.getTime() ?? 0) < TRUST_NOT_FOUND_MS) return { result: 'not_found', reason: 'Not in the sending mailbox' };
  return { result: 'unknown', reason: 'Not in the sending mailbox, but the attempt is over an hour old and Ethereal deletes messages after a few hours' };
}

/** The check found it: record it as sent. sentAt is the claim time, just before the SMTP send. */
export const markFoundSent = (email: Email, event: AuditInput, from: EmailStatus) =>
  updateEmail(email.id, { status: 'sent', sentAt: email.claimedAt, messageId: messageIdFor(email.id), error: null }, event, [from]);

const NOT_RETRYABLE = 'Only failed or needs-check emails can be retried';

/**
 * "Retry send" for a failed or needs-check email. Audited through updateEmail (unlike a Bull Board retry).
 * A needs-check email may already have gone out, so its mailbox is checked first. If the check can't tell, only `force` sends again.
 */
export async function retryEmail(userId: string, id: string, force = false): Promise<{ result: 'sent' | 'queued' }> {
  const email = await prisma.email.findFirst({ where: { id, userId }, include: { sender: true } });
  if (!email) throw new HttpError(404, 'Email not found');
  const event = { userId, campaignId: email.campaignId, actor: `user:${userId}`, fromStatus: email.status };

  const check = email.status === 'needs_check' ? await checkDelivery(email) : null;
  if (check?.result === 'found') {
    if (!(await markFoundSent(email, { ...event, type: 'delivery_checked', data: check }, 'needs_check'))) throw new HttpError(409, NOT_RETRYABLE);
    return { result: 'sent' };
  }
  if (check?.result === 'unknown' && !force) throw new HttpError(409, `${check.reason}. Sending it again may deliver a second copy.`, 'delivery_unknown');

  const data = check ? { check: check.result, reason: check.reason, forced: force } : undefined;
  const ok = await updateEmail(email.id, { status: 'scheduled', scheduledAt: new Date(), error: null }, { ...event, type: 'retry_requested', data }, ['needs_check', 'failed']);
  if (!ok) throw new HttpError(409, NOT_RETRYABLE);
  await emailQueue.add('send', { emailId: email.id }, { jobId: `${email.id}-retry-${email.attempts}` });
  return { result: 'queued' };
}
