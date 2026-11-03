import { useHistory } from '../api/hooks';
import type { AuditEvent } from '../api/types';
import { clock, day } from '../lib/format';
import { Spinner } from './ui';

// Audit event types (backend docs/07) in words a user understands.
const labels: Record<string, string> = {
  scheduled: 'Scheduled',
  claimed: 'Picked up by a worker',
  sent: 'Sent',
  failed: 'Failed',
  needs_check: 'Needs check',
  sender_broken: 'Sending mailbox login failed',
  retry_requested: 'Retry requested',
  smtp_deferred: 'Mail server said try later',
  deferred_rate_limit: 'Moved to the next window (rate limit)',
  queue_paused: 'Queue paused (system limit)',
  skipped_duplicate: 'Duplicate run skipped',
  delivery_checked: 'Checked the sending mailbox',
};

// user:<id> is always the signed-in user here (history is filtered by user); workers keep host:pid for debugging.
const who = (actor: string) => (actor.startsWith('user:') ? 'you' : actor.replace(/^(worker|system):/, '$1 '));

function detail(e: AuditEvent) {
  const d = e.data as Record<string, string | undefined>;
  if (d.newTime) return `New time: ${day(d.newTime)} ${clock(d.newTime)}`;
  return d.smtpResponse ?? d.error ?? d.reason ?? null;
}

/** One email's audit trail, oldest first. */
export function History({ emailId }: { emailId: string }) {
  const history = useHistory(emailId);
  if (history.isPending) return <Spinner label="Loading history" />;
  if (history.isError) return <p className="text-sm text-stamp">Couldn’t load the history: {history.error.message}</p>;
  return (
    <ol className="space-y-4 border-l-2 border-line pl-4">
      {history.data.items.map((e) => (
        <li key={e.id}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">{labels[e.type] ?? e.type}</span>
            <time className="text-xs whitespace-nowrap text-muted tabular-nums" dateTime={e.createdAt}>
              {day(e.createdAt)} {clock(e.createdAt)}
            </time>
          </div>
          {detail(e) && <p className="text-sm break-all text-muted">{detail(e)}</p>}
          <p className="text-xs text-muted">by {who(e.actor)}</p>
        </li>
      ))}
    </ol>
  );
}
