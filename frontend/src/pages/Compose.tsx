import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useHealth, useSchedule, useSenders } from '../api/hooks';
import { Button, buttonClass, Field, inputClass, Spinner } from '../components/ui';
import { extractEmails } from '../lib/extractEmails';
import { clock, day } from '../lib/format';

export function Compose() {
  const navigate = useNavigate();
  const senders = useSenders();
  const schedule = useSchedule();
  const per = useHealth().data?.limitWindow ?? 'hour'; // "minute" when the demo shortens the limit window
  // Made once per form: if the same form is submitted twice (double-click, retry after an error), the server keeps one campaign.
  const [campaignId] = useState(() => crypto.randomUUID());
  const [senderId, setSenderId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [leads, setLeads] = useState<{ file: string; emails: string[]; duplicates: number } | null>(null);
  const [startAt, setStartAt] = useState(''); // empty = now; a pre-filled time would go stale while the user writes
  const [delaySec, setDelaySec] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const from = senderId || senders.data?.items[0]?.id || '';

  const onFile = async (file: File | undefined) => {
    if (!file) return setLeads(null);
    setLeads({ file: file.name, ...extractEmails(await file.text()) });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!leads?.emails.length) return void toast.error('Upload a CSV or text file with at least one email address.');
    schedule.mutate(
      { campaignId, senderId: from, subject, body, leads: leads.emails, startAt: (startAt ? new Date(startAt) : new Date()).toISOString(), delayMs: Math.round(delaySec * 1000), hourlyLimit },
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
    <form onSubmit={submit}>
      <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Field label="From" htmlFor="from" hint="Ethereal test mailboxes: emails are caught for preview, never delivered.">
            {senders.isPending ? (
              <div className={inputClass}>
                <Spinner label="Setting up your sending mailboxes…" />
              </div>
            ) : senders.isError ? (
              <p className="text-stamp">Couldn’t load your mailboxes: {senders.error.message}</p>
            ) : (
              <select id="from" value={from} onChange={(e) => setSenderId(e.target.value)} className={inputClass}>
                {senders.data.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.email}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Subject" htmlFor="subject">
            <input id="subject" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Body" htmlFor="body" hint="Plain text. Every lead gets the same email.">
            <textarea id="body" required rows={12} maxLength={50_000} value={body} onChange={(e) => setBody(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <div className="space-y-5">
          <Field
            label="Leads"
            htmlFor="leads"
            hint={
              leads ? (
                <>
                  <span className="text-2xl font-semibold text-ink tabular-nums">{leads.emails.length}</span> email addresses in {leads.file}
                  {leads.duplicates > 0 && `, ${leads.duplicates} duplicate${leads.duplicates === 1 ? '' : 's'} removed`}
                </>
              ) : (
                'A CSV or .txt file. Addresses are found in any column.'
              )
            }
          >
            <input
              id="leads"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-2 file:font-medium file:text-ink hover:file:border-muted"
            />
          </Field>
          <Field label="Start time" htmlFor="startAt" hint="Leave empty to start now. In your local time.">
            <input id="startAt" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Delay between emails (seconds)" htmlFor="delay">
            <input id="delay" type="number" min={0} max={3600} step="any" required value={delaySec} onChange={(e) => setDelaySec(Number(e.target.value))} className={inputClass} />
          </Field>
          <Field label={per === 'hour' ? 'Hourly limit' : `Limit per ${per}`} htmlFor="limit" hint={`Emails per ${per} from this campaign. The rest move to the next ${per}, in order.`}>
            <input id="limit" type="number" min={1} max={10_000} required value={hourlyLimit} onChange={(e) => setHourlyLimit(Number(e.target.value))} className={inputClass} />
          </Field>
          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="primary" busy={schedule.isPending} disabled={!from || !leads?.emails.length} className="flex-1">
              {leads?.emails.length ? `Schedule ${leads.emails.length} emails` : 'Schedule'}
            </Button>
            <Link to="/dashboard" className={buttonClass('ghost')}>
              Cancel
            </Link>
          </div>
        </div>
      </div>
    </form>
  );
}
