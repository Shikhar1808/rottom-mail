import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useHealth, useSchedule, useSenders } from '../api/hooks';
import { Editor } from '../components/Editor';
import { ArrowLeftIcon, ClockIcon, FileIcon, PaperclipIcon, UploadIcon, XIcon } from '../components/icons';
import { Button, IconButton, menuItemClass, Spinner, useDismiss } from '../components/ui';
import { extractEmails } from '../lib/extractEmails';
import { clock, day, fileSize, stamp } from '../lib/format';
import { quickTimes, toLocalInput } from '../lib/sendLater';

// The server's limits (backend services/campaigns.ts): the same files go with every email.
const MAX_FILES = 3;
const MAX_BYTES = 2 * 1024 * 1024;

/** File contents as base64, for the JSON request. */
const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** The Figma's compose screen. Recipients come from "Upload List" or typed addresses; the clock picks a later start. */
export function Compose() {
  const navigate = useNavigate();
  const senders = useSenders();
  const schedule = useSchedule();
  const per = useHealth().data?.limitWindow ?? 'hour'; // "minute" when the demo shortens the limit window
  // Made once per form: if the same form is submitted twice (double-click, retry after an error), the server keeps one campaign.
  const [campaignId] = useState(() => crypto.randomUUID());
  const [senderId, setSenderId] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState({ html: '', text: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [typed, setTyped] = useState(''); // addresses typed into "To", not yet turned into chips
  const [note, setNote] = useState('');
  const [startAt, setStartAt] = useState<Date | null>(null); // null = now
  const [delaySec, setDelaySec] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const from = senderId || senders.data?.items[0]?.id || '';

  /** Adds every address found in the text, skipping ones already added. Returns how many it found. */
  const add = (text: string, source?: string) => {
    const { emails, duplicates } = extractEmails(text);
    const have = new Set(recipients);
    const fresh = emails.filter((e) => !have.has(e));
    setRecipients([...recipients, ...fresh]);
    const skipped = duplicates + emails.length - fresh.length;
    if (source) setNote(`${fresh.length} added from ${source}${skipped ? `, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped` : ''}.`);
    return emails.length;
  };
  const addTyped = () => {
    if (typed.trim() && add(typed)) setTyped(''); // text with no address stays, so it can be fixed
  };

  const attach = (picked: File[]) => {
    const next = [...files, ...picked.filter((f) => !files.some((g) => g.name === f.name && g.size === f.size))];
    if (next.length > MAX_FILES) return void toast.error(`Up to ${MAX_FILES} attachments. They go with every email.`);
    if (next.reduce((n, f) => n + f.size, 0) > MAX_BYTES) return void toast.error('Attachments can be 2 MB in total. They go with every email.');
    setFiles(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const leads = [...new Set([...recipients, ...extractEmails(typed).emails])];
    if (!leads.length) return void toast.error('Add at least one recipient: type an address or upload a list.');
    if (!message.text) return void toast.error('Write a message first.');
    setReading(true);
    const attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type || 'application/octet-stream', content: await toBase64(f) }))).finally(() =>
      setReading(false),
    );
    schedule.mutate(
      {
        campaignId,
        senderId: from,
        subject,
        body: message.text,
        html: message.html,
        attachments,
        leads,
        startAt: (startAt ?? new Date()).toISOString(),
        delayMs: Math.round(delaySec * 1000),
        hourlyLimit,
      },
      {
        onSuccess: (r) => {
          toast.success(`Scheduled ${r.count} emails. The first goes out ${day(r.firstSendAt)} at ${clock(r.firstSendAt)}.`);
          navigate('/dashboard?tab=scheduled');
        },
        onError: (err) => toast.error(`Couldn’t schedule: ${err.message}`),
      },
    );
  };

  return (
    <form onSubmit={submit} className="min-h-screen">
      <div className="airmail h-1.5" />
      <header className="flex items-center gap-2 px-3 py-3 md:px-5">
        <Link to="/dashboard" aria-label="Back to emails" className="grid size-8 place-items-center rounded-full hover:bg-field">
          <ArrowLeftIcon className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-medium">Compose New Email</h1>
        <IconButton label={`Attach files (up to ${MAX_FILES}, 2 MB in total)`} onClick={() => filePicker.current?.click()}>
          <PaperclipIcon className="size-5" />
        </IconButton>
        <input
          ref={filePicker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            attach([...(e.target.files ?? [])]);
            e.target.value = ''; // the same file can be picked again after removing it
          }}
        />
        <SendLater value={startAt} onChange={setStartAt} />
        <Button type="submit" className="rounded-full px-5" busy={schedule.isPending || reading} disabled={!from}>
          {startAt ? 'Send Later' : 'Send'}
        </Button>
      </header>

      <div className="mx-auto max-w-3xl px-4 pb-10 md:px-6">
        <Row label="From" htmlFor="from">
          {senders.isPending ? (
            <Spinner label="Setting up your sending mailboxes…" />
          ) : senders.isError ? (
            <p className="text-sm text-stamp">Couldn’t load your mailboxes: {senders.error.message}</p>
          ) : (
            <select id="from" value={from} onChange={(e) => setSenderId(e.target.value)} className="max-w-full min-w-0 truncate rounded-md bg-field px-2.5 py-1.5 text-sm focus:outline-none">
              {senders.data.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email}
                </option>
              ))}
            </select>
          )}
        </Row>

        <Row label="To" htmlFor="to">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {recipients.slice(0, 3).map((r) => (
              <Chip key={r}>{r}</Chip>
            ))}
            {recipients.length > 3 && <Chip>+{recipients.length - 3}</Chip>}
            <input
              id="to"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault(); // Enter here adds the address instead of sending the form
                  addTyped();
                }
              }}
              onBlur={addTyped}
              onPaste={(e) => {
                if (add(e.clipboardData.getData('text'))) e.preventDefault(); // a pasted list becomes chips; other text pastes as usual
              }}
              placeholder={recipients.length ? '' : 'recipient@example.com'}
              className="min-w-40 flex-1 bg-transparent py-1 text-sm placeholder:text-muted focus:outline-none"
            />
          </div>
          {recipients.length > 0 && (
            <IconButton
              label="Remove all recipients"
              onClick={() => {
                setRecipients([]);
                setNote('');
              }}
            >
              <XIcon />
            </IconButton>
          )}
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-brand focus-within:outline-2 focus-within:outline-brand hover:bg-brand-soft">
            <UploadIcon />
            Upload List
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) add(await file.text(), file.name);
                e.target.value = ''; // the same file can be chosen again
              }}
            />
          </label>
        </Row>
        {(recipients.length > 0 || note) && (
          <p className="pt-1.5 text-xs text-muted" aria-live="polite">
            <span className="font-semibold text-ink tabular-nums">{recipients.length}</span> recipient{recipients.length === 1 ? '' : 's'}. {note}
          </p>
        )}

        <Row label="Subject" htmlFor="subject">
          <input id="subject" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="min-w-0 flex-1 bg-transparent py-1 text-sm placeholder:text-muted focus:outline-none" />
        </Row>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
          <label className="flex items-center gap-2">
            Delay between 2 emails
            <input type="number" min={0} max={3600} step="any" required value={delaySec} onChange={(e) => setDelaySec(Number(e.target.value))} className={numberClass} />
            <span className="text-muted">sec</span>
          </label>
          <label className="flex items-center gap-2" title={`Emails per ${per} from this campaign. The rest move to the next ${per}, in order.`}>
            {per === 'hour' ? 'Hourly Limit' : `Limit per ${per}`}
            <input type="number" min={1} max={10_000} required value={hourlyLimit} onChange={(e) => setHourlyLimit(Number(e.target.value))} className={numberClass} />
          </label>
        </div>

        <Editor onChange={setMessage} placeholder="Type Your Reply..." />
        {files.length > 0 && (
          <ul aria-label="Attachments" className="mt-3 flex flex-wrap gap-3">
            {files.map((f) => (
              <AttachmentCard key={`${f.name}-${f.size}`} file={f} onRemove={() => setFiles(files.filter((g) => g !== f))} />
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Every recipient gets the same email and files. Ethereal catches it for preview, so it never reaches a real inbox.</p>
      </div>
    </form>
  );
}

/** A picked file, like the Figma's image cards: a preview for pictures, an icon for anything else. */
function AttachmentCard({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <li className="relative w-44 overflow-hidden rounded-xl border border-line bg-white">
      {url ? <img src={url} alt="" className="h-24 w-full object-cover" /> : <FileIcon className="mx-auto my-6 size-10 text-muted" />}
      <div className="px-3 py-2">
        <p className="truncate text-xs font-medium" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-muted">{fileSize(file.size)}</p>
      </div>
      <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove} className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-white/90 text-muted shadow hover:text-ink">
        <XIcon className="size-3.5" />
      </button>
    </li>
  );
}

const numberClass = 'w-20 rounded-md border border-line px-2 py-1 text-center tabular-nums focus:border-brand focus:outline-none';

function Row({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-2 focus-within:border-brand">
      <label htmlFor={htmlFor} className="w-14 shrink-0 text-sm text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

const Chip = ({ children }: { children: ReactNode }) => (
  <span className="max-w-56 truncate rounded-full border border-brand/40 bg-brand-soft px-2.5 py-0.5 text-xs text-brand">{children}</span>
);

/** The clock button and its "Send Later" menu from the Figma: a date and time, or a quick pick. */
function SendLater({ value, onChange }: { value: Date | null; onChange: (d: Date | null) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useDismiss(open, () => setOpen(false));
  const pick = (d: Date) => {
    onChange(d);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      {value && (
        <span className="hidden items-center gap-1 rounded-full bg-later-soft py-0.5 pr-0.5 pl-2.5 text-xs font-medium text-later tabular-nums sm:inline-flex">
          {stamp(value)}
          <button type="button" aria-label="Clear the send time and send now" onClick={() => onChange(null)} className="grid size-5 place-items-center rounded-full hover:bg-later/10">
            <XIcon className="size-3" />
          </button>
        </span>
      )}
      <IconButton
        label={value ? `Sends ${stamp(value)}. Change the time` : 'Send later'}
        aria-expanded={open}
        onClick={() => {
          setDraft(value ? toLocalInput(value) : '');
          setOpen((o) => !o);
        }}
        className={value ? 'text-later' : ''}
      >
        <ClockIcon className="size-5" />
      </IconButton>
      {open && (
        <div className="absolute top-full right-0 z-20 mt-2 w-72 rounded-xl border border-line bg-white p-4 shadow-lg">
          <p className="text-sm font-semibold">Send Later</p>
          <input
            type="datetime-local"
            aria-label="Pick date & time"
            value={draft}
            min={toLocalInput(new Date())}
            onChange={(e) => setDraft(e.target.value)}
            className="mt-3 w-full border-b border-line pb-1.5 text-sm focus:border-brand focus:outline-none"
          />
          <ul className="mt-3">
            {quickTimes().map(({ label }, i) => (
              <li key={label}>
                {/* Computed on click, so "In 1 minute" counts from the click, not from when the menu opened. */}
                <button type="button" onClick={() => pick(quickTimes()[i].at)} className={menuItemClass}>
                  {label}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="rounded-full" disabled={!draft} onClick={() => pick(new Date(draft))}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
