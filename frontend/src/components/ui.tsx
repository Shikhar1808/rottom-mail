import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from 'react';
import type { EmailStatus } from '../api/types';
import { stamp } from '../lib/format';
import { ClockIcon } from './icons';

type Variant = 'primary' | 'outline' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-[#006e31] disabled:bg-brand/50',
  outline: 'border border-brand text-brand hover:bg-brand-soft disabled:border-brand/40 disabled:text-brand/50 disabled:hover:bg-transparent',
  ghost: 'text-muted hover:bg-field hover:text-ink disabled:opacity-50',
};

/** Shared by <Button> and links that look like buttons (Compose, Login with Google). */
export const buttonClass = (variant: Variant = 'outline') =>
  `inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]}`;

export function Button({ variant, busy, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button type="button" {...props} disabled={props.disabled || busy} className={`${buttonClass(variant)} ${props.className ?? ''}`}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

/** A round icon-only button: refresh, filter, send later. */
export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...props} className={`grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-field hover:text-ink ${props.className ?? ''}`}>
      {children}
    </button>
  );
}

const pill: Record<EmailStatus, [label: string, cls: string]> = {
  scheduled: ['Scheduled', 'border-later/25 bg-later-soft text-later'],
  sending: ['Sending now', 'border-later/25 bg-later-soft text-later'],
  sent: ['Sent', 'border-line bg-field text-muted'],
  failed: ['Failed', 'border-stamp/20 bg-stamp/10 text-stamp'],
  needs_check: ['Needs check', 'border-warn/25 bg-warn/10 text-warn'],
};

/** Scheduled emails show their send time, like the Figma's orange clock pill. Everything else shows its status. */
export function StatusPill({ status, scheduledAt }: { status: EmailStatus; scheduledAt: string }) {
  const [label, cls] = pill[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums ${cls}`}>
      {(status === 'scheduled' || status === 'sending') && <ClockIcon className="size-3.5" />}
      {status === 'scheduled' ? stamp(scheduledAt) : label}
    </span>
  );
}

export function Avatar({ name, src, className = 'size-8' }: { name: string; src?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  if (src && !broken) {
    // no-referrer: Google's avatar host refuses some requests that carry a Referer.
    return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`${className} shrink-0 rounded-full`} />;
  }
  return <span aria-hidden className={`${className} grid shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-white`}>{initials}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <span className="size-4 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" aria-hidden />
      {label ?? <span className="sr-only">Loading</span>}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-base font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

/** For small popovers: closes on a click outside or Escape. Put the returned ref on the wrapper around the trigger and the popover. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

export const menuItemClass = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-field';
