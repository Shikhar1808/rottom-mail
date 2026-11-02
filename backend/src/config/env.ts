import { z } from 'zod';

try {
  process.loadEnvFile();
} catch {
  // no .env file: use the real environment
}
// nodemailer reuses one cached Ethereal account per process by default; every sender needs its own.
process.env.ETHEREAL_CACHE ??= 'no';

const int = (def: number) => z.coerce.number().int().nonnegative().default(def);
// 0 here would stop all sending without an error (or divide by zero), so refuse to start instead.
const positive = (def: number) => z.coerce.number().int().positive().default(def);

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6380'),
  ELASTICSEARCH_URL: z.string().default('http://127.0.0.1:9200'),
  APP_URL: z.url(),
  PORT: int(4000),

  ENCRYPTION_KEY: z.string().refine((k) => Buffer.from(k, 'base64').length === 32, 'must be 32 random bytes, base64'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_REDIRECT_URI: z.string().default(''),

  RATE_LIMIT_MODE: z.enum(['per_sender', 'global']).default('per_sender'),
  WORKER_CONCURRENCY: positive(5),
  WORKER_QUEUES: z.string().default('emails,search-sync,notifications'),
  MIN_DELAY_BETWEEN_SENDS_MS: int(2000),
  MAX_EMAILS_PER_HOUR: positive(200),
  MAX_EMAILS_PER_HOUR_PER_SENDER: positive(200),
  RATE_LIMIT_WINDOW_MS: positive(3_600_000),

  SMTP_MODE: z.enum(['ethereal', 'fake']).default('ethereal'),
  DEV_LOGIN: z.stringbool().default(false), // one-click login as dev@example.com; only on a localhost APP_URL
  DEFAULT_SENDERS_PER_USER: int(2),
  MAX_SENDERS_PER_USER: int(5),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:\n' + parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const env = parsed.data;
export const isHttps = env.APP_URL.startsWith('https://');
// Also needs a localhost APP_URL, so a dev .env copied to the server can't open a no-password login there.
export const devLogin =
  env.DEV_LOGIN && env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(new URL(env.APP_URL).hostname);
