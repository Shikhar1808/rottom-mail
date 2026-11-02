import type { EmailStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { searchSyncQueue } from '../lib/queues';

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
