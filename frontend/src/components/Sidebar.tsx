import { type ComponentType, type SVGProps, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useCounts, useLogout } from '../api/hooks';
import type { Me } from '../api/types';
import { ChevronDownIcon, ClockIcon, SendIcon } from './icons';
import { SlackMenuItem } from './Slack';
import { Avatar, buttonClass, menuItemClass, useDismiss } from './ui';

export type Tab = 'scheduled' | 'sent';

/** The Figma's sidebar: wordmark, profile (with its menu), Compose, and the two mailboxes with their counts. */
export function Sidebar({ me, tab, onNavigate }: { me: Me; tab: Tab | null; onNavigate: () => void }) {
  const counts = useCounts();
  return (
    <aside className="flex flex-col gap-4 border-b border-line p-4 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
      <Link to="/dashboard" onClick={onNavigate} className="font-pixel text-[26px] leading-none" aria-label="rottom-mail, back to Scheduled">
        ROTTOM
      </Link>
      <ProfileMenu me={me} />
      <Link to="/compose" className={`${buttonClass('outline')} w-full`}>
        Compose
      </Link>
      <nav aria-label="Mailboxes">
        <p className="px-3 pb-1 text-[11px] font-medium text-muted">CORE</p>
        <NavItem to="scheduled" Icon={ClockIcon} label="Scheduled" count={counts.data?.scheduled} active={tab === 'scheduled'} onNavigate={onNavigate} />
        <NavItem to="sent" Icon={SendIcon} label="Sent" count={counts.data?.sent} active={tab === 'sent'} onNavigate={onNavigate} />
      </nav>
    </aside>
  );
}

type NavProps = { to: Tab; Icon: ComponentType<SVGProps<SVGSVGElement>>; label: string; count?: number; active: boolean; onNavigate: () => void };

function NavItem({ to, Icon, label, count, active, onNavigate }: NavProps) {
  return (
    <Link
      to={`/dashboard?tab=${to}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${active ? 'bg-brand-soft font-semibold' : 'hover:bg-field'}`}
    >
      <Icon />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-xs text-muted tabular-nums">{count}</span>}
    </Link>
  );
}

/** Profile card from the Figma. Its arrow opens the things that have no place in the Figma: Slack, the queue dashboard, logout. */
function ProfileMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const logout = useLogout();
  const navigate = useNavigate();
  const onLogout = () =>
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login', { replace: true }),
      onError: (err) => toast.error(`Couldn't log out: ${err.message}`),
    });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Account menu for ${me.name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-lg bg-field p-2 text-left hover:bg-line"
      >
        <Avatar name={me.name} src={me.avatarUrl} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold">{me.name}</span>
          <span className="block truncate text-xs text-muted">{me.email}</span>
        </span>
        <ChevronDownIcon className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-line bg-white p-1 shadow-lg md:right-auto md:w-64">
          <SlackMenuItem />
          {me.isAdmin && (
            <a href="/admin/queues" target="_blank" rel="noreferrer" className={menuItemClass}>
              Queue dashboard
            </a>
          )}
          <Link to="/privacy" className={menuItemClass}>
            Privacy policy
          </Link>
          <button type="button" disabled={logout.isPending} onClick={onLogout} className={`${menuItemClass} border-t border-line`}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
