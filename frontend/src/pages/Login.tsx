import { useEffect } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useHealth, useMe } from '../api/hooks';
import { buttonClass } from '../components/ui';

// The backend sends failed logins back to /login?error=<reason>.
const errors: Record<string, string> = {
  cancelled: 'Login cancelled.',
  state: 'That login link expired or was opened twice. Try again.',
  unverified: 'Your Google email address isn’t verified, so it can’t be used to log in.',
  google: 'Google didn’t accept the login. Try again.',
  not_configured: 'Google login isn’t set up on this server yet (GOOGLE_CLIENT_ID is empty).',
};

const GoogleG = () => (
  <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

export function Login() {
  const me = useMe();
  const health = useHealth();
  const [params] = useSearchParams();

  useEffect(() => {
    const reason = params.get('error');
    if (reason) toast.error(errors[reason] ?? 'Login failed. Try again.', { id: 'login-error' });
  }, [params]);

  if (me.data) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="airmail h-2" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
        <p className="text-xl font-bold tracking-tight">rottom-mail</p>
        <h1 className="mt-8 text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">Schedule cold emails and watch every one go out.</h1>
        <p className="mt-5 max-w-xl text-lg text-muted">
          Upload your leads, pick a start time and a pace. Sending stays inside your hourly limits, and each email shows up here when it leaves.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          {/* A full-page navigation, not fetch: the OAuth flow goes to Google and back. */}
          <a href="/auth/google" className={`${buttonClass('primary')} px-5 py-3 text-base`}>
            <span className="grid size-7 place-items-center rounded-full bg-white">
              <GoogleG />
            </span>
            Continue with Google
          </a>
          {health.data?.devLogin && (
            <a href="/auth/dev" className={`${buttonClass('secondary')} px-5 py-3 text-base`}>
              Dev login (local only)
            </a>
          )}
        </div>
        {me.isError && <p className="mt-6 text-stamp">The server isn’t answering. Start the API with npm run dev:api, then reload.</p>}
      </main>
      <footer className="mx-auto w-full max-w-2xl px-6 pb-8 text-sm text-muted">
        <Link to="/privacy" className="underline">
          Privacy policy
        </Link>
      </footer>
    </div>
  );
}
