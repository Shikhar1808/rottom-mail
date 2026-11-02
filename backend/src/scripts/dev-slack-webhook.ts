// Dev only: saves a Slack Incoming Webhook URL for a user, so alerts can be tried before the Slack OAuth app exists.
// Get a URL in your Slack app: Incoming Webhooks → "Add New Webhook to Workspace".
// Usage: npm run dev:slack-webhook <https://hooks.slack.com/...> [user email, default dev@example.com]
import { env } from '../config/env';
import { encrypt } from '../utils/crypto';
import { prisma } from '../lib/db';
import { notificationsQueue } from '../lib/queues';
import { redis } from '../lib/redis';
import { audit } from '../services/emails';

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('dev-slack-webhook is disabled in production');
  const [url, email = 'dev@example.com'] = process.argv.slice(2);
  if (!url?.startsWith('https://hooks.slack.com/')) throw new Error('usage: npm run dev:slack-webhook <https://hooks.slack.com/...> [user email]');
  const user = await prisma.user.findFirst({ where: { email }, orderBy: { createdAt: 'asc' } });
  if (!user) throw new Error(`no user with email ${email} (log in once, or run npm run dev:session)`);

  const data = {
    teamId: 'dev',
    teamName: 'Dev webhook',
    channel: 'the webhook channel',
    channelId: 'dev',
    webhookUrlEnc: encrypt(url),
    accessTokenEnc: encrypt(''), // no OAuth token: disconnect skips the revoke call
    status: 'active' as const,
    lastError: null,
    connectedAt: new Date(),
  };
  await prisma.slackIntegration.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  await audit({ userId: user.id, type: 'slack_connected', actor: 'system:dev-slack-webhook', data: { team: data.teamName } });
  await notificationsQueue.add('connected', { kind: 'connected', userId: user.id });
  console.log(`webhook saved for ${email}; a "connected" test message is queued (needs npm run dev:worker)`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await notificationsQueue.close();
    await redis.quit();
    await prisma.$disconnect();
  });
