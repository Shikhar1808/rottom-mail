// All times are shown in the viewer's own time zone.
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const stampFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const longFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "14:07:41": the history timeline and toasts. */
export const clock = (iso: string) => clockFmt.format(new Date(iso));
/** "Tue, 3 Nov". */
export const day = (iso: string) => dayFmt.format(new Date(iso));
/** "Tue 2:07:41 PM": the pill on scheduled emails. Seconds matter when emails are 2s apart. */
export const stamp = (at: string | Date) => stampFmt.format(new Date(at));
/** "Nov 3, 10:23 AM": the date on the email page. */
export const longDate = (iso: string) => longFmt.format(new Date(iso));
/** "340 KB", "1.2 MB". */
export const fileSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
/** "2:07 PM": the time at the end of a sent row. */
export const shortTime = (at: string | Date) => timeFmt.format(new Date(at));
