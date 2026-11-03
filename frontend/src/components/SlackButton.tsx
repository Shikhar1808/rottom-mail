import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useDisconnectSlack, useSlack } from '../api/hooks';
import { buttonClass, Button } from './ui';

// The Slack flow ends with a redirect to /dashboard?slack=<result>.
const results: Record<string, [kind: 'success' | 'error' | 'info', message: string]> = {
  connected: ['success', 'Slack connected. A test message is on its way to your channel.'],
  cancelled: ['info', 'Slack connection cancelled.'],
  error: ['error', "Couldn't connect Slack. Try again."],
  not_configured: ['error', "Slack isn't set up on this server yet (SLACK_CLIENT_ID is empty)."],
};

export function SlackButton() {
  const slack = useSlack();
  const disconnect = useDisconnectSlack();
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

  // Full-page navigation: the OAuth flow leaves the app and comes back.
  const connect = (label: string) => (
    <a href="/api/slack/connect" className={buttonClass('secondary')}>
      {label}
    </a>
  );

  if (!slack.data) return null;
  if (!slack.data.connected) return connect('Connect Slack');
  if (slack.data.status === 'broken') {
    return <span title={`Slack stopped accepting alerts: ${slack.data.lastError ?? 'unknown error'}`}>{connect('Reconnect Slack')}</span>;
  }
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="text-muted" title={`Rate-limit alerts go to ${slack.data.channel} in ${slack.data.teamName}`}>
        Slack: <span className="font-medium text-ink">{slack.data.channel}</span>
      </span>
      <Button
        variant="ghost"
        className="px-2 py-1 text-sm"
        busy={disconnect.isPending}
        onClick={() => disconnect.mutate(undefined, { onSuccess: () => toast.success('Slack disconnected.'), onError: (e) => toast.error(e.message) })}
      >
        Disconnect
      </Button>
    </div>
  );
}
