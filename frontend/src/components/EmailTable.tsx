import { useEffect, useReducer, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../api/client';
import { useRetry } from '../api/hooks';
import type { EmailItem } from '../api/types';
import { clock, day, relative } from '../lib/format';
import { HistoryDialog } from './HistoryDialog';
import { Button, StatusBadge } from './ui';

/** One table for the Scheduled tab, the Sent tab and search results. Time comes first, like a departures board. */
export function EmailTable({ items }: { items: EmailItem[] }) {
  const [open, setOpen] = useState<EmailItem | null>(null);
  const retry = useRetry();
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 30_000); // keeps "in 3 minutes" current between polls
    return () => clearInterval(t);
  }, []);

  // A needs-check email is looked up in the mailbox first. Only when that can't tell does the user decide, with the risk spelled out.
  const onRetry = (e: EmailItem, force = false) =>
    retry.mutate(
      { id: e.id, force },
      {
        onSuccess: (r) =>
          r.result === 'sent'
            ? toast.success(`${e.toEmail} had already gone out, so it's now marked as sent. Nothing was sent again.`)
            : toast.success(`Retry queued for ${e.toEmail}. It goes out within the rate limit.`),
        onError: (err) =>
          err instanceof ApiError && err.code === 'delivery_unknown'
            ? toast.warning(err.message, { duration: Infinity, action: { label: 'Send anyway', onClick: () => onRetry(e, true) } })
            : toast.error(err.message),
      },
    );

  return (
    <>
      <table className="w-full text-left text-[15px]">
        <thead className="text-sm text-muted">
          <tr>
            <th className="py-2 pr-4 pl-4 font-medium">Time</th>
            <th className="py-2 pr-4 font-medium">To</th>
            <th className="hidden py-2 pr-4 font-medium md:table-cell">Subject</th>
            <th className="hidden py-2 pr-4 font-medium lg:table-cell">From</th>
            <th className="hidden py-2 pr-4 font-medium sm:table-cell">Status</th>
            <th className="py-2 pr-4">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const at = e.sentAt ?? e.scheduledAt;
            return (
              <tr key={e.id} className="border-t border-line align-top">
                <td className="py-3 pr-4 pl-4">
                  <div className="text-lg leading-tight font-semibold whitespace-nowrap tabular-nums">{clock(at)}</div>
                  <div className="text-sm text-muted">
                    {day(at)}, {relative(at)}
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <div className="font-medium break-all">{e.toEmail}</div>
                  <div className="text-sm text-muted md:hidden">{e.subject}</div>
                  <div className="mt-1 sm:hidden">
                    <StatusBadge status={e.status} />
                  </div>
                </td>
                <td className="hidden py-3 pr-4 md:table-cell">{e.subject}</td>
                <td className="hidden py-3 pr-4 text-muted lg:table-cell">{e.from}</td>
                <td className="hidden py-3 pr-4 sm:table-cell">
                  <StatusBadge status={e.status} />
                  {e.error && e.status !== 'sent' && (
                    <p className="mt-1 line-clamp-2 max-w-60 text-sm text-muted" title={e.error}>
                      {e.error}
                    </p>
                  )}
                </td>
                <td className="py-3 pr-4">
                  <div className="flex flex-col items-end gap-1 whitespace-nowrap sm:flex-row sm:items-center sm:justify-end">
                  {e.previewUrl && (
                    <a href={e.previewUrl} target="_blank" rel="noreferrer" aria-label={`Preview email to ${e.toEmail}`} className="px-2 font-medium text-airmail hover:underline">
                      Preview
                    </a>
                  )}
                  {(e.status === 'failed' || e.status === 'needs_check') && (
                    <Button variant="ghost" className="-my-1 px-2 py-1" aria-label={`Retry send to ${e.toEmail}`} busy={retry.isPending && retry.variables?.id === e.id} onClick={() => onRetry(e)}>
                      Retry send
                    </Button>
                  )}
                  <Button variant="ghost" className="-my-1 px-2 py-1" aria-label={`History for ${e.toEmail}`} onClick={() => setOpen(e)}>
                    History
                  </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <HistoryDialog email={open} onClose={() => setOpen(null)} />
    </>
  );
}
