import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useEmails, useMe, useSearch } from '../api/hooks';
import type { SentFilter } from '../api/types';
import { EmailList } from '../components/EmailList';
import { FilterIcon, RefreshIcon, SearchIcon } from '../components/icons';
import { Sidebar, type Tab } from '../components/Sidebar';
import { useSlackResult } from '../components/Slack';
import { Button, EmptyState, IconButton, menuItemClass, Spinner, useDismiss } from '../components/ui';

const TITLES: Record<Tab, string> = { scheduled: 'Scheduled', sent: 'Sent' };
const FILTERS: [SentFilter | null, string][] = [
  [null, 'All'],
  ['sent', 'Sent'],
  ['failed', 'Failed'],
  ['needs_check', 'Needs check'],
];

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Dashboard() {
  useSlackResult();
  const me = useMe().data!; // <SignedIn> only renders this page with a session
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'sent' ? 'sent' : 'scheduled';
  const status = tab === 'sent' ? (FILTERS.find(([f]) => f === params.get('status'))?.[0] ?? null) : null;
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 300);
  const [refreshing, setRefreshing] = useState(false);

  // The lists already poll every 5s; the button is for "now", and spins only when pressed.
  const refresh = () => {
    setRefreshing(true);
    Promise.all([qc.refetchQueries({ queryKey: ['emails'], type: 'active' }), qc.refetchQueries({ queryKey: ['search'], type: 'active' })]).finally(() => setRefreshing(false));
  };

  return (
    <div className="min-h-screen">
      <div className="airmail h-1.5" />
      <div className="md:flex">
        <Sidebar me={me} tab={query ? null : tab} onNavigate={() => setQ('')} />
        <main className="min-w-0 flex-1 px-3 py-4 md:px-5">
          <h1 className="sr-only">{query ? `Search results for ${query}` : TITLES[tab]}</h1>
          <div className="flex items-center gap-1.5">
            <label className="flex max-w-xl min-w-0 flex-1 items-center gap-2 rounded-full bg-field px-3.5 py-2 text-muted focus-within:ring-2 focus-within:ring-brand/40">
              <SearchIcon />
              <input
                type="search"
                maxLength={200}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search emails"
                placeholder="Search"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
              />
            </label>
            {tab === 'sent' && !query && <StatusFilter value={status} onChange={(f) => setParams(f ? { tab, status: f } : { tab })} />}
            <IconButton label="Refresh" onClick={refresh}>
              <RefreshIcon className={`size-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`} />
            </IconButton>
          </div>
          {status && !query && (
            <p className="mt-2 px-3 text-xs text-muted">
              Showing only “{FILTERS.find(([f]) => f === status)![1]}”.{' '}
              <button type="button" onClick={() => setParams({ tab })} className="font-medium text-brand hover:underline">
                Show all
              </button>
            </p>
          )}
          <section className="mt-2">{query ? <SearchResults q={query} /> : <TabEmails tab={tab} status={status} />}</section>
        </main>
      </div>
    </div>
  );
}

function StatusFilter({ value, onChange }: { value: SentFilter | null; onChange: (f: SentFilter | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <IconButton label="Filter sent emails" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={value ? 'bg-brand-soft text-brand' : ''}>
        <FilterIcon />
      </IconButton>
      {open && (
        <div className="absolute top-full right-0 z-20 mt-1 w-44 rounded-lg border border-line bg-white p-1 shadow-lg">
          {FILTERS.map(([f, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={value === f}
              onClick={() => {
                onChange(f);
                setOpen(false);
              }}
              className={`${menuItemClass} ${value === f ? 'font-semibold text-brand' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TabEmails({ tab, status }: { tab: Tab; status: SentFilter | null }) {
  const emails = useEmails(tab, status);
  if (emails.isPending) return <Loading label="Loading emails" />;
  if (emails.isError) return <EmptyState title="Couldn’t load emails">{emails.error.message}</EmptyState>;

  const items = emails.data.pages.flatMap((p) => p.items);
  if (!items.length) {
    if (status) return <EmptyState title="Nothing here">No emails with this status.</EmptyState>;
    return tab === 'scheduled' ? (
      <EmptyState title="Nothing scheduled">
        <Link to="/compose" className="font-medium text-brand hover:underline">
          Compose a campaign
        </Link>{' '}
        to queue emails. They wait here until they go out.
      </EmptyState>
    ) : (
      <EmptyState title="No emails sent yet">Scheduled emails move here as soon as they go out.</EmptyState>
    );
  }
  return (
    <>
      <EmailList items={items} />
      {emails.hasNextPage && (
        <div className="border-t border-line p-3 text-center">
          <Button variant="ghost" busy={emails.isFetchingNextPage} onClick={() => emails.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

function SearchResults({ q }: { q: string }) {
  const search = useSearch(q);
  if (search.isPending) return <Loading label="Searching" />;
  if (search.isError) return <EmptyState title="Search isn’t available">{search.error.message}</EmptyState>;
  if (!search.data.items.length) {
    return <EmptyState title={`No emails match “${q}”`}>Search looks at recipient addresses, subjects and email text.</EmptyState>;
  }
  return <EmailList items={search.data.items} />;
}

const Loading = ({ label }: { label: string }) => (
  <div className="px-6 py-16 text-center">
    <Spinner label={label} />
  </div>
);
