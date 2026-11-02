import { env } from '../config/env';

// Errors after which this webhook will never work again (docs/06). Classified by Slack's error string, not HTTP status.
export const PERMANENT_SLACK_ERRORS = new Set([
  'no_service',
  'no_active_hooks',
  'invalid_token',
  'channel_not_found',
  'channel_is_archived',
  'team_disabled',
  'no_team',
  'action_prohibited',
]);

// Slack mrkdwn: escape user text, so a subject like "<!channel>" can't ping everyone.
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// "200 per hour" in production, "5 per minute" with the 60s demo window.
function per(ms: number) {
  for (const [unit, size] of [['hour', 3_600_000], ['minute', 60_000]] as const) {
    if (ms % size === 0) return ms === size ? unit : `${ms / size} ${unit}s`;
  }
  return `${ms / 1000}s`;
}

// <!date> shows each reader's own time zone; the text after | is the fallback.
const slackTime = (ms: number) => `<!date^${Math.floor(ms / 1000)}^{time}|${utc(ms)}>`;
const utc = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

export function connectedMessage(channel: string) {
  const where = esc(channel);
  return {
    text: `✅ ReachInbox connected. Rate-limit alerts for your senders will appear in ${where}.`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `✅ *ReachInbox connected.* Rate-limit alerts for your senders will appear in ${where}.` } }],
  };
}

export type LimitInfo = { scope: 'per_sender' | 'global'; senderEmail: string; subject: string; limit: number; resumeAt: number; queued: number };

export function limitMessage(i: LimitInfo) {
  const global = i.scope === 'global';
  const rate = `${i.limit} per ${per(env.RATE_LIMIT_WINDOW_MS)}`;
  const sender = esc(i.senderEmail);
  return {
    text: global
      ? `⚠️ System limit reached (${rate} across all senders). Queue paused until ${utc(i.resumeAt)}.`
      : `⚠️ Limit reached for ${sender} (${rate}). Sending resumes at ${utc(i.resumeAt)}.`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: global ? '⚠️ System limit reached' : '⚠️ Sender limit reached' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: global ? '*Scope*\nAll senders' : `*Sender*\n${sender}` },
          { type: 'mrkdwn', text: `*Limit*\n${rate}` },
          { type: 'mrkdwn', text: `*Still queued*\n${i.queued} emails` },
          { type: 'mrkdwn', text: `*${global ? 'Paused until' : 'Resumes'}*\n${slackTime(i.resumeAt)}` },
        ],
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Campaign: ${esc(i.subject)} · ${global ? 'global' : 'per-sender'} mode · <${env.APP_URL}/dashboard|Open dashboard>` },
        ],
      },
    ],
  };
}
