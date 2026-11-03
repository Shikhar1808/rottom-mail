// Finds every email address in a CSV or plain-text file, whatever the columns are. The backend validates each one again.
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

export function extractEmails(text: string) {
  const found = (text.match(EMAIL) ?? []).map((e) => e.toLowerCase());
  const emails = [...new Set(found)];
  return { emails, duplicates: found.length - emails.length };
}
