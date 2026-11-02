import crypto from 'node:crypto';
import { prisma } from '../lib/db';
import { chunk } from '../utils/helpers';
import { emailQueue, searchSyncQueue } from '../lib/queues';
import { redis } from '../lib/redis';
import { audit } from './emails';

type Due = { id: string; scheduledAt: Date };

/** One delayed job per email. jobId = email id, so re-adding an existing job is a no-op (safe to repeat). */
export async function enqueueEmails(rows: Due[]) {
  const now = Date.now();
  for (const part of chunk(rows, 500)) {
    await emailQueue.addBulk(
      part.map((r) => ({
        name: 'send',
        data: { emailId: r.id },
        opts: { jobId: r.id, delay: Math.max(0, r.scheduledAt.getTime() - now) },
      })),
    );
  }
}

/**
 * Runs once on API boot: rebuilds Redis from Postgres. Every row still "scheduled" is re-queued with its own id,
 * so jobs that survived are left alone and jobs Redis lost come back (overdue ones run right away).
 * A Redis lock keeps several API instances from doing it at the same time.
 */
export async function repairQueues() {
  const token = crypto.randomUUID();
  if (!(await redis.set('repair_lock', token, 'EX', 300, 'NX'))) {
    console.log('startup repair: already running on another instance');
    return;
  }
  try {
    let total = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.email.findMany({
        where: { status: 'scheduled' },
        select: { id: true, scheduledAt: true },
        orderBy: { id: 'asc' },
        take: 1000,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });
      if (!batch.length) break;
      // A row can still be "scheduled" after its job gave up (e.g. Postgres was down for every try). BullMQ ignores
      // re-adding an id that exists, so drop finished jobs first. The atomic claim still stops a double send.
      await Promise.all(
        batch.map(async (r) => {
          const state = await emailQueue.getJobState(r.id);
          if (state === 'failed' || state === 'completed') await emailQueue.remove(r.id);
        }),
      );
      await enqueueEmails(batch);
      total += batch.length;
      cursor = batch[batch.length - 1].id;
    }
    // Search copy: rows whose latest version never reached ES (crash between commit and queueing, ES down too long).
    let stale = 0;
    for (cursor = undefined; ; ) {
      const batch: { id: string }[] = await prisma.email.findMany({
        where: { indexedVersion: { lt: prisma.email.fields.version } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });
      if (!batch.length) break;
      await searchSyncQueue.add('repair', { emailIds: batch.map((r) => r.id) });
      stale += batch.length;
      cursor = batch[batch.length - 1].id;
    }
    await audit({ userId: 'system', type: 'startup_repair', actor: 'system:startup-repair', data: { requeuedChecked: total, reindexQueued: stale } });
    console.log(`startup repair: ${total} scheduled emails checked against the queue, ${stale} queued for re-indexing`);
  } finally {
    if ((await redis.get('repair_lock')) === token) await redis.del('repair_lock');
  }
}
