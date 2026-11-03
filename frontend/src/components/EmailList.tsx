import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '../api/client';
import { useRetry } from '../api/hooks';
import type { EmailItem } from '../api/types';
import { shortTime } from '../lib/format';
import { Button, StatusPill } from './ui';

export const canRetry = (e: Pick<EmailItem, 'status'>) => e.status === 'failed' || e.status === 'needs_check';

/**
 * "Retry send" with its messages. A needs-check email is looked up in the mailbox first;
 * only when that can't tell does the user decide, with the risk spelled out.
 */
export function useRetryEmail() {
  const retry = useRetry();
  const run = (e: Pick<EmailItem, 'id' | 'toEmail'>, force = false) =>
    retry.mutate(
      { id: e.id, force },
      {
        onSuccess: (r) =>
          r.result === 'sent'
            ? toast.success(`${e.toEmail} had already gone out, so it's now marked as sent. Nothing was sent again.`)
            : toast.success(`Retry queued for ${e.toEmail}. It goes out within the rate limit.`),
        onError: (err) =>
          err instanceof ApiError && err.code === 'delivery_unknown'
            ? toast.warning(err.message, { duration: Infinity, action: { label: 'Send anyway', onClick: () => run(e, true) } })
            : toast.error(err.message),
      },
    );
  return { run, busyId: retry.isPending ? retry.variables?.id : undefined };
}

/** The Figma's inbox rows: who, a time or status pill, subject and the start of the message. A row opens the email. */
export function EmailList({ items }: { items: EmailItem[] }) {
  const retry = useRetryEmail();
  return (
    <ul className="divide-y divide-line">
      {items.map((e) => (
        <li key={e.id} className="relative flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-3 hover:bg-field/70 sm:flex-nowrap">
          {/* The whole row is the link; Retry sits above it. */}
          <Link to={`/emails/${e.id}`} aria-label={`Open email to ${e.toEmail}: ${e.subject}`} className="absolute inset-0 rounded-sm" />
          <span className="w-full truncate text-sm font-medium sm:w-56 sm:shrink-0">To: {e.toEmail}</span>
          <span title={e.error ?? undefined}>
            <StatusPill status={e.status} scheduledAt={e.scheduledAt} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold">{e.subject}</span>
            {e.preview && <span className="text-muted"> – {e.preview}</span>}
          </span>
          {canRetry(e) && (
            <Button variant="outline" className="relative z-10 px-2.5 py-1 text-xs" aria-label={`Retry send to ${e.toEmail}`} busy={retry.busyId === e.id} onClick={() => retry.run(e)}>
              Retry
            </Button>
          )}
          {e.sentAt && (
            <time dateTime={e.sentAt} className="shrink-0 text-xs text-muted tabular-nums">
              {shortTime(e.sentAt)}
            </time>
          )}
        </li>
      ))}
    </ul>
  );
}
