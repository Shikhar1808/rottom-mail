import { type Job, UnrecoverableError } from 'bullmq';
import { decrypt } from '../utils/crypto';
import { prisma } from '../lib/db';
import type { NotificationJob } from '../lib/queues';
import { audit } from '../services/emails';
import { connectedMessage, limitMessage, PERMANENT_SLACK_ERRORS } from '../services/slack';

const actor = 'worker:notifications';

export async function processNotification(job: Job<NotificationJob>) {
  const n = job.data;
  const event = (type: string, data: Record<string, string | number>) => audit({ userId: n.userId, type, actor, data: { kind: n.kind, ...data } });

  // Read on every alert (no cache), so disconnect and reconnect take effect immediately.
  const slack = await prisma.slackIntegration.findUnique({ where: { userId: n.userId } });
  if (slack?.status !== 'active') return void (await event('slack_skipped', { reason: slack ? 'broken' : 'not connected' }));

  const message = n.kind === 'connected' ? connectedMessage(slack.channel) : limitMessage(await limitInfo(n));
  const res = await fetch(decrypt(slack.webhookUrlEnc), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10_000),
  });
  const reply = (await res.text()).trim().slice(0, 200);
  if (res.ok) return void (await event('slack_notified', { status: res.status, channel: slack.channel }));

  if (PERMANENT_SLACK_ERRORS.has(reply)) {
    // The webhook is gone (app removed, channel archived...): stop trying, the UI shows "Reconnect Slack".
    await prisma.slackIntegration.update({ where: { userId: n.userId }, data: { status: 'broken', lastError: reply } });
    await event('slack_broken', { status: res.status, error: reply });
    throw new UnrecoverableError(`slack: ${reply}`);
  }
  await event('slack_failed', { status: res.status, error: reply, attempt: job.attemptsMade + 1 });
  throw new Error(`slack ${res.status}: ${reply}`); // 429 / 5xx: BullMQ retries with backoff
}

async function limitInfo(n: Extract<NotificationJob, { kind: 'limit_reached' }>) {
  const [sender, campaign, queued] = await Promise.all([
    prisma.sender.findUnique({ where: { id: n.senderId }, select: { email: true } }),
    prisma.campaign.findUnique({ where: { id: n.campaignId }, select: { subject: true } }),
    // Per-sender: that sender's backlog. Global: only this user's own emails (never other users' numbers).
    prisma.email.count({ where: { status: 'scheduled', ...(n.scope === 'global' ? { userId: n.userId } : { senderId: n.senderId }) } }),
  ]);
  return { scope: n.scope, senderEmail: sender?.email ?? 'unknown sender', subject: campaign?.subject ?? '', limit: n.limit, resumeAt: n.resumeAt, queued };
}
