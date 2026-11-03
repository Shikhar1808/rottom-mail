// All times are shown in the viewer's own time zone.
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const rel = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export const clock = (iso: string) => clockFmt.format(new Date(iso));
export const day = (iso: string) => dayFmt.format(new Date(iso));

/** "in 3 minutes", "2 hours ago", "now". */
export function relative(iso: string, now = Date.now()) {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  if (Math.abs(s) < 10) return rel.format(0, 'second'); // "now"
  for (const [unit, size] of [['day', 86_400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(s) >= size) return rel.format(Math.round(s / size), unit);
  }
  return rel.format(s, 'second');
}
