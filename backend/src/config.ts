import { z } from 'zod';

try {
  process.loadEnvFile();
} catch {
  // no .env file: use the real environment
}
// nodemailer reuses one cached Ethereal account per process by default; every sender needs its own.
process.env.ETHEREAL_CACHE ??= 'no';

const int = (def: number) => z.coerce.number().int().nonnegative().default(def);

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  APP_URL: z.url(),
  PORT: int(4000),

  ENCRYPTION_KEY: z.string().refine((k) => Buffer.from(k, 'base64').length === 32, 'must be 32 random bytes, base64'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_REDIRECT_URI: z.string().default(''),

  RATE_LIMIT_MODE: z.enum(['per_sender', 'global']).default('per_sender'),
  WORKER_CONCURRENCY: int(5),
  WORKER_QUEUES: z.string().default('emails,search-sync,notifications'),
  MIN_DELAY_BETWEEN_SENDS_MS: int(2000),
  MAX_EMAILS_PER_HOUR: int(200),
  MAX_EMAILS_PER_HOUR_PER_SENDER: int(200),
  RATE_LIMIT_WINDOW_MS: int(3_600_000),

  SMTP_MODE: z.enum(['ethereal', 'fake']).default('ethereal'),
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
