import { useEffect, useRef } from 'react';
import { useHistory } from '../api/hooks';
import type { AuditEvent, EmailItem } from '../api/types';
import { clock, day } from '../lib/format';
import { Button, Spinner } from './ui';

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

export function HistoryDialog({ email, onClose }: { email: EmailItem | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const history = useHistory(email?.id ?? null);

  useEffect(() => {
    if (email) ref.current?.showModal();
    else ref.current?.close();
  }, [email]);

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(36rem,calc(100%-2rem))] rounded-lg p-0 text-ink backdrop:bg-ink/40">
      {email && (
        <div className="p-6">
          <h2 className="text-lg font-semibold break-all">History for {email.toEmail}</h2>
          <p className="text-muted">{email.subject}</p>
          {history.isPending ? (
            <div className="py-8">
              <Spinner label="Loading history" />
            </div>
          ) : (
            <ol className="mt-5 space-y-4 border-l-2 border-line pl-4">
              {history.data?.items.map((e) => (
                <li key={e.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{labels[e.type] ?? e.type}</span>
                    <time className="text-sm whitespace-nowrap text-muted tabular-nums" dateTime={e.createdAt}>
                      {clock(e.createdAt)}
                    </time>
                  </div>
                  {detail(e) && <p className="text-sm break-all text-muted">{detail(e)}</p>}
                  <p className="text-sm text-muted">by {who(e.actor)}</p>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-6 flex justify-end">
            <Button onClick={() => ref.current?.close()}>Close</Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
