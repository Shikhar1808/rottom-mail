import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useLogout } from '../api/hooks';
import type { Me } from '../api/types';
import { SlackButton } from './SlackButton';
import { Button } from './ui';

function Avatar({ me }: { me: Me }) {
  const [broken, setBroken] = useState(false);
  const initials = me.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  if (me.avatarUrl && !broken) {
    // no-referrer: Google's avatar host refuses some requests that carry a Referer.
    return <img src={me.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-9 rounded-full" />;
  }
  return <span className="grid size-9 place-items-center rounded-full bg-airmail text-sm font-semibold text-white">{initials}</span>;
}

export function Header({ me }: { me: Me }) {
  const logout = useLogout();
  const navigate = useNavigate();
  const onLogout = () =>
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login', { replace: true }),
      onError: (err) => toast.error(`Couldn't log out: ${err.message}`),
    });

  return (
    <header className="border-b border-line bg-white">
      <div className="airmail h-1.5" />
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
        <Link to="/dashboard" className="text-xl font-bold tracking-tight">
          rottom-mail
        </Link>
        <div className="ml-auto flex items-center gap-4">
          <SlackButton />
          <div className="flex items-center gap-3">
            <Avatar me={me} />
            <div className="hidden leading-tight sm:block">
              <div className="font-semibold">{me.name}</div>
              <div className="text-sm text-muted">{me.email}</div>
            </div>
          </div>
          <Button variant="ghost" busy={logout.isPending} onClick={onLogout}>
            Log out
          </Button>
        </div>
      </div>
    </header>
  );
}
