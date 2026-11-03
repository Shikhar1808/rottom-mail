import { shortTime } from './format';

/** The same day tomorrow at hour:00, in the viewer's time zone. */
export function tomorrowAt(hour: number, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Quick picks in the Send Later menu: the Figma's "Tomorrow" ones, plus two short ones that suit a live demo. */
export function quickTimes(now = new Date()) {
  const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000);
  return [
    { label: 'In 1 minute', at: inMinutes(1) },
    { label: 'In 5 minutes', at: inMinutes(5) },
    ...[10, 11, 15].map((h) => ({ label: `Tomorrow, ${shortTime(tomorrowAt(h, now))}`, at: tomorrowAt(h, now) })),
  ];
}

/** A Date as the value of <input type="datetime-local">, which wants local time without a zone. */
export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
