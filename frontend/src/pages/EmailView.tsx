import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { isLive, useEmail, useMe } from '../api/hooks';
import { canRetry, useRetryEmail } from '../components/EmailList';
import { History } from '../components/History';
import { ArrowLeftIcon, FileIcon } from '../components/icons';
import { Avatar, Button, buttonClass, EmptyState, Spinner, StatusPill } from '../components/ui';
import { fileSize, longDate } from '../lib/format';

/** The Figma's email page: subject bar, sender, date, message. Below it, what only this app has: Ethereal preview, Retry, history. */
export function EmailView() {
  const { id } = useParams<{ id: string }>();
  const email = useEmail(id!);
  const me = useMe().data!;
  const retry = useRetryEmail();
  const e = email.data;
  const back = `/dashboard?tab=${e && e.status !== 'scheduled' && e.status !== 'sending' ? 'sent' : 'scheduled'}`;

  return (
    <div className="min-h-screen">
      <div className="airmail h-1.5" />
      <header className="flex items-center gap-3 border-b border-line px-3 py-3 md:px-5">
        <Link to={back} aria-label="Back to emails" className="grid size-8 place-items-center rounded-full text-ink hover:bg-field">
          <ArrowLeftIcon className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-medium">{e?.subject ?? 'Email'}</h1>
        {e && <StatusPill status={e.status} scheduledAt={e.scheduledAt} />}
        <Avatar name={me.name} src={me.avatarUrl} />
      </header>

      {email.isPending ? (
        <div className="py-16 text-center">
          <Spinner label="Loading email" />
        </div>
      ) : !e ? (
        <EmptyState title="Email not found">
          It may belong to another account, or the link is wrong.{' '}
          <Link to="/dashboard" className="font-medium text-brand hover:underline">
            Back to your emails
          </Link>
        </EmptyState>
      ) : (
        <main className="mx-auto max-w-3xl px-4 py-6 md:px-6">
          <div className="flex items-start gap-3">
            <Avatar name={e.from} className="size-9" />
            <div className="min-w-0 flex-1 text-sm leading-tight">
              <p className="font-semibold break-all">{e.from}</p>
              <p className="mt-0.5 text-muted break-all">to {e.toEmail}</p>
            </div>
            <time dateTime={e.sentAt ?? e.scheduledAt} className="shrink-0 text-right text-sm text-muted">
              {e.sentAt ? longDate(e.sentAt) : `Sends ${longDate(e.scheduledAt)}`}
            </time>
          </div>

          {e.error && e.status !== 'sent' && <p className="mt-5 rounded-lg border border-stamp/20 bg-stamp/5 px-3 py-2 text-sm text-stamp">{e.error}</p>}
          <div className="mt-6">{e.html ? <Message html={e.html} /> : <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">{e.body}</p>}</div>

          {e.attachments.length > 0 && (
            <ul aria-label="Attachments" className="mt-6 flex flex-wrap gap-3">
              {e.attachments.map((a) => (
                <li key={a.id} className="flex w-56 items-center gap-2.5 rounded-xl border border-line px-3 py-2.5">
                  <FileIcon className="size-6 shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium" title={a.filename}>
                      {a.filename}
                    </span>
                    <span className="block text-xs text-muted">{fileSize(a.size)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {(e.previewUrl || canRetry(e)) && (
            <div className="mt-8 flex flex-wrap gap-2">
              {e.previewUrl && (
                <a href={e.previewUrl} target="_blank" rel="noreferrer" className={buttonClass('outline')}>
                  Open in Ethereal
                </a>
              )}
              {canRetry(e) && (
                <Button busy={retry.busyId === e.id} onClick={() => retry.run(e)}>
                  Retry send
                </Button>
              )}
            </div>
          )}

          <section aria-labelledby="history" className="mt-10 border-t border-line pt-6">
            <h2 id="history" className="mb-4 text-sm font-semibold">
              History
            </h2>
            <History emailId={e.id} live={isLive(e.status)} />
          </section>
        </main>
      )}
    </div>
  );
}

// Message styles inside the frame, matching the editor.
const frameCss = `body{margin:0;font:15px/1.6 Inter,system-ui,sans-serif;color:#1d2125;overflow-wrap:anywhere}
p{margin:0 0 .5em}a{color:#00843b}blockquote{margin:0 0 .5em;padding-left:.8em;border-left:4px solid #eceef0;color:#646b73}`;

/**
 * The formatted message, in a sandboxed frame: without allow-scripts nothing in it can run, so the user's HTML can't touch the app.
 * allow-same-origin only lets this page read the frame's height; links open in a new tab.
 */
function Message({ html }: { html: string }) {
  const [height, setHeight] = useState(120);
  return (
    <iframe
      title="Message"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={`<!doctype html><html><head><base target="_blank"><style>${frameCss}</style></head><body>${html}</body></html>`}
      onLoad={(ev) => setHeight(ev.currentTarget.contentDocument?.documentElement.scrollHeight ?? 120)}
      style={{ height }}
      className="w-full border-0"
    />
  );
}
