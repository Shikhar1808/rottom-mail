import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useEmails, useSearch } from '../api/hooks';
import { EmailTable } from '../components/EmailTable';
import { Button, buttonClass, EmptyState, inputClass, Spinner } from '../components/ui';

const TABS = { scheduled: 'Scheduled', sent: 'Sent' } as const;
type Tab = keyof typeof TABS;

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Dashboard() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'sent' ? 'sent' : 'scheduled';
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 300);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="sr-only">Emails</h1>
        <div role="tablist" aria-label="Emails" className="flex gap-6">
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={!query && tab === t}
              onClick={() => {
                setQ('');
                setParams({ tab: t });
              }}
              className={`border-b-2 pb-1.5 text-lg font-semibold ${!query && tab === t ? 'border-airmail text-ink' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {TABS[t]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex w-full gap-2 sm:w-auto">
          <input
            type="search"
            maxLength={200}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search emails"
            placeholder="Search address or subject"
            className={`${inputClass} sm:w-72`}
          />
          <Link to="/compose" className={buttonClass('primary')}>
            Compose
          </Link>
        </div>
      </div>
      <section className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">{query ? <SearchResults q={query} /> : <TabEmails tab={tab} />}</section>
    </>
  );
}

function TabEmails({ tab }: { tab: Tab }) {
  const emails = useEmails(tab);
  if (emails.isPending) return <Loading label="Loading emails" />;
  if (emails.isError) return <EmptyState title="Couldn’t load emails">{emails.error.message}</EmptyState>;

  const items = emails.data.pages.flatMap((p) => p.items);
  if (!items.length) {
    return tab === 'scheduled' ? (
      <EmptyState title="Nothing scheduled">
        <Link to="/compose" className="font-medium text-airmail hover:underline">
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
      <EmailTable items={items} />
      {emails.hasNextPage && (
        <div className="border-t border-line p-3 text-center">
          <Button busy={emails.isFetchingNextPage} onClick={() => emails.fetchNextPage()}>
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
  return <EmailTable items={search.data.items} />;
}

const Loading = ({ label }: { label: string }) => (
  <div className="px-6 py-16 text-center">
    <Spinner label={label} />
  </div>
);
