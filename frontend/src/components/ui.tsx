import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { EmailStatus } from '../api/types';

type Variant = 'primary' | 'secondary' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-airmail text-white hover:bg-[#173f6f] disabled:bg-airmail/50',
  secondary: 'border border-line bg-white text-ink hover:border-muted disabled:text-muted',
  ghost: 'text-muted hover:text-ink disabled:opacity-50',
};

/** Shared by <Button> and links that look like buttons (Compose, Connect Slack). */
export const buttonClass = (variant: Variant = 'secondary') =>
  `inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-[15px] font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]}`;

export function Button({ variant, busy, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button type="button" {...props} disabled={props.disabled || busy} className={`${buttonClass(variant)} ${props.className ?? ''}`}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export const inputClass =
  'w-full rounded-md border border-line bg-white px-3 py-2 text-[15px] placeholder:text-muted/70 focus:border-airmail focus:outline-none focus-visible:outline-2';

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

const badge: Record<EmailStatus, [string, string]> = {
  scheduled: ['Scheduled', 'bg-airmail/10 text-airmail'],
  sending: ['Sending', 'bg-airmail text-white'],
  sent: ['Sent', 'bg-sent/10 text-sent'],
  failed: ['Failed', 'bg-stamp/10 text-stamp'],
  needs_check: ['Needs check', 'bg-warn/10 text-warn'],
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  const [label, cls] = badge[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap ${cls}`}>{label}</span>;
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
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-muted">{children}</div>}
    </div>
  );
}
