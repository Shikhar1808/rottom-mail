// One line per event: time, level, message and context (emailId, userId, ms...). Readable in development,
// JSON in production so log tools can filter by field. Reads NODE_ENV directly: config/env.ts logs before it's ready.
export type Fields = Record<string, unknown>;
type Level = 'info' | 'warn' | 'error';

const asJson = process.env.NODE_ENV === 'production';

const value = (v: unknown) => (typeof v === 'string' ? (/[\s"=]/.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v));

function write(level: Level, msg: string, fields: Fields = {}) {
  const out = level === 'info' ? console.log : console.error;
  const kept = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (asJson) return out(JSON.stringify({ time: new Date().toISOString(), level, msg, ...Object.fromEntries(kept) }));
  const now = new Date();
  const time = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}`;
  const { stack, ...rest } = Object.fromEntries(kept);
  out(`${time} ${level.toUpperCase().padEnd(5)} ${msg}${Object.entries(rest).map(([k, v]) => ` ${k}=${value(v)}`).join('')}${stack ? `\n${stack}` : ''}`);
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};

type ErrorLike = {
  name?: string;
  message?: string;
  code?: string | number;
  cause?: unknown;
  errors?: ErrorLike[];
  address?: string;
  port?: number;
  responseCode?: number; // SMTP (nodemailer)
  response?: string | { status?: number; data?: unknown }; // SMTP reply text, or an HTTP response (gaxios)
};

/** "ETIMEDOUT connect ETIMEDOUT 1.2.3.4:443". An AggregateError (every IPv6 and IPv4 attempt failed) lists each attempt. */
function describe(e: ErrorLike): string {
  if (!e || typeof e !== 'object') return String(e);
  const text = [e.code, e.message || e.name].filter(Boolean).join(' ');
  if (!Array.isArray(e.errors)) return text;
  const attempts = e.errors.map((x) => [x.code ?? x.message, x.address && `${x.address}${x.port ? `:${x.port}` : ''}`].filter(Boolean).join(' '));
  return `${text} [${attempts.join(', ')}]`;
}

/**
 * Log fields for an error: the message, any code and status, the server's reply, and the chain of causes.
 * Never the request settings an HTTP library keeps on its errors: for the Google token call they hold the client secret.
 */
export function errorFields(err: unknown): Fields {
  const e = err as ErrorLike;
  const top = describe(e);
  const causes: string[] = [];
  for (let c = e?.cause, depth = 0; c && depth < 5; c = (c as ErrorLike).cause, depth++) {
    const text = describe(c as ErrorLike);
    if (text !== top && text !== causes.at(-1)) causes.push(text); // HTTP libraries often wrap an error in a copy of itself
  }
  const http = typeof e?.response === 'object' ? e.response : undefined;
  const data = http?.data as { error?: unknown; error_description?: unknown } | undefined;
  const reply = typeof e?.response === 'string' ? e.response : (data?.error_description ?? data?.error);
  return {
    error: top,
    status: e?.responseCode ?? http?.status,
    reply: typeof reply === 'string' ? reply.slice(0, 300) : undefined,
    cause: causes.length ? causes.join(' <- ') : undefined,
  };
}
