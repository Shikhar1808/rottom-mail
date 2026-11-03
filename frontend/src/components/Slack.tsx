import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useDisconnectSlack, useSlack } from '../api/hooks';
import { menuItemClass } from './ui';

// The Slack flow ends with a redirect to /dashboard?slack=<result>.
const results: Record<string, [kind: 'success' | 'error' | 'info', message: string]> = {
  connected: ['success', 'Slack connected. A test message is on its way to your channel.'],
  cancelled: ['info', 'Slack connection cancelled.'],
  error: ['error', "Couldn't connect Slack. Try again."],
  not_configured: ['error', "Slack isn't set up on this server yet (SLACK_CLIENT_ID is empty)."],
};

/** Shows how the Slack connection went, once, then tidies the URL. Used on the dashboard, where Slack sends people back. */
export function useSlackResult() {
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const result = results[params.get('slack') ?? ''];
    if (!result) return;
    toast[result[0]](result[1], { id: 'slack-result' }); // the id stops a double toast in React's dev double-render
    setParams(
      (p) => {
        p.delete('slack');
        return p;
      },
      { replace: true },
    );
  }, [params, setParams]);
}

/** The Slack part of the profile menu: connect, or where alerts go and a way to disconnect. */
export function SlackMenuItem() {
  const slack = useSlack();
  const disconnect = useDisconnectSlack();

  // Full-page navigation: the OAuth flow leaves the app and comes back.
  const connect = (label: string, hint: string) => (
    <a href="/api/slack/connect" className={`${menuItemClass} flex-col items-start gap-0`}>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted">{hint}</span>
    </a>
  );

  if (!slack.data) return null;
  if (!slack.data.connected) return connect('Connect Slack', 'Get an alert when a sending limit is hit');
  if (slack.data.status === 'broken') return connect('Reconnect Slack', `Slack stopped accepting alerts: ${slack.data.lastError ?? 'unknown error'}`);
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate" title={`Rate-limit alerts go to ${slack.data.channel} in ${slack.data.teamName}`}>
        Slack: <span className="font-medium">{slack.data.channel}</span>
      </span>
      <button
        type="button"
        disabled={disconnect.isPending}
        className="text-xs font-medium text-muted hover:text-stamp disabled:opacity-50"
        onClick={() => disconnect.mutate(undefined, { onSuccess: () => toast.success('Slack disconnected.'), onError: (e) => toast.error(e.message) })}
      >
        Disconnect
      </button>
    </div>
  );
}
