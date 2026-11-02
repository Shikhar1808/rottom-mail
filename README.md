# rottom-mail: Email Job Scheduler (ReachInbox assignment)

A production-style email scheduler with a dashboard. Users log in with Google, upload a list of leads, and schedule emails. The emails are stored in Postgres, fired at the right time by **BullMQ delayed jobs** in Redis (no cron), and sent through **Ethereal** (fake SMTP). The system survives restarts without losing or repeating emails, enforces per-sender rate limits safely across many workers, alerts **Slack** when a limit is reached, and makes every email searchable in **Elasticsearch**.

> **Status:** design complete (see [`docs/`](./docs/README.md)). Implementation in progress, tracked in [`docs/10-timeline.md`](./docs/10-timeline.md). Run commands below are the planned ones and will be checked against the code before submission.

## How it works

```
Browser ──HTTPS──► rottom.your-domain.com (Caddy in prod / Vite proxy locally)
                        │  /api /auth /admin
                        ▼
                  API (private, :4000) ──► Postgres (source of truth)
                        │                    ▲
                        ▼                    │
                Redis / BullMQ ──► Workers: emails · search-sync · notifications
                                      │            │              │
                                Ethereal SMTP   Elasticsearch   Slack webhook
```

- **Scheduling:** each email is a row in Postgres plus a BullMQ delayed job with `jobId = email.id`. Rows are committed first, and the job's delay is stored as a timestamp in Redis.
- **Restarts:** Redis keeps jobs on disk (AOF, `noeviction`). On boot, one instance re-queues every `scheduled` row (duplicates are ignored). An atomic claim (`scheduled → sending`) and a crash check (IMAP Message-ID lookup) mean no email is sent twice and none restarts from scratch.
- **Rate limiting:** two switchable implementations, `RATE_LIMIT_MODE=per_sender | global`. Per-sender uses one atomic Redis Lua script per sender (slot + hourly counter). Jobs over the limit move to the next window in order and are never dropped.
- **Slack:** a real OAuth connect. One live message the moment a limit is reached. Disconnect and reconnect work without a redeploy.
- **Search:** a sync queue copies changes to ES with version checks. Search uses ES to find the IDs and Postgres to show the rows.

Full detail: [architecture](./docs/01-architecture.md) · [decisions](./docs/02-design-decisions.md).

## Requirements → design

| Requirement | How | Doc | Done |
|---|---|---|---|
| Accept scheduling requests via API | `POST /api/campaigns` (zod) | [01](./docs/01-architecture.md#api) | ⬜ |
| Store in a relational DB | Postgres + Prisma, one row per recipient | [01](./docs/01-architecture.md#data-model-prisma-planned) | ⬜ |
| BullMQ delayed jobs, no cron | `delay` + `jobId`. ESLint fails the build on cron code | [03](./docs/03-scheduling-persistence.md#no-cron) | ⬜ |
| Multiple senders via Ethereal | 2 Ethereal mailboxes auto-created per user, pooled SMTP | [08](./docs/08-senders-ethereal.md) | ⬜ |
| Searchable via Elasticsearch | `search-sync` queue + "ES finds, Postgres shows" | [05](./docs/05-search-elasticsearch.md) | ⬜ |
| Live BullMQ dashboard | Bull Board `/admin/queues` (read-only, behind login) | [07](./docs/07-audit-observability.md#bull-board) | ⬜ |
| Survive restarts, no duplicates | AOF + startup repair + jobId + atomic claim + crash check | [03](./docs/03-scheduling-persistence.md) | ⬜ |
| Configurable worker concurrency | `WORKER_CONCURRENCY`, safe in parallel | [09](./docs/09-scaling-impacts.md) | ⬜ |
| Minimum delay between sends | `MIN_DELAY_BETWEEN_SENDS_MS=2000` | [04](./docs/04-rate-limiting.md) | ⬜ |
| Emails per hour, Redis-backed, safe across workers, delayed not dropped | Lua counters per `window + sender` / global counter + pause | [04](./docs/04-rate-limiting.md) | ⬜ |
| Slack alert on limit hit (real OAuth, live) | `incoming-webhook` OAuth, `notifications` queue | [06](./docs/06-auth-slack.md#slack-connect) | ⬜ |
| Behaviour with 1000+ emails | Book a slot and step aside, overflow by window, `SMTP_MODE=fake` load test | [09](./docs/09-scaling-impacts.md) | ⬜ |
| Google login (real), header with name/email/avatar, logout | Backend OAuth (state + PKCE), Redis sessions | [06](./docs/06-auth-slack.md#google-login) | ⬜ |
| Dashboard: Scheduled / Sent tabs, Compose button | Shared `EmailTable`, loading + empty states | [01](./docs/01-architecture.md#planned-folder-layout) | ⬜ |
| Compose: subject, body, CSV upload with count, start time, delay, hourly limit | `extractEmails` (regex + dedupe) | [01](./docs/01-architecture.md#end-to-end-flow-gmail-login--email-sent) | ⬜ |
| Clean frontend code (reusable UI, types, toasts) | UI kit + typed API client + TanStack Query | [01](./docs/01-architecture.md#planned-folder-layout) | ⬜ |

**Beyond the brief:** append-only audit trail with a per-email timeline, crash check (Option C) + "Needs check" / Retry send, two limiter implementations to compare, SMTP 4xx/5xx handling, encrypted secrets.

## Chosen delay and limits

- **At least 2 seconds between sends** (`MIN_DELAY_BETWEEN_SENDS_MS=2000`). Per sender in per-sender mode, system-wide in global mode.
- **200 emails per hour** (`MAX_EMAILS_PER_HOUR_PER_SENDER` / `MAX_EMAILS_PER_HOUR`). Keep the per-sender value ≤ 200: Ethereal itself rejects public accounts above 200/hour.
- When the limit is reached, jobs move to the **next window in arrival order** and are never failed or dropped. Slack gets one message per window. Comparison and trade-offs: [docs/04](./docs/04-rate-limiting.md#side-by-side).

## Run it locally (planned, will be checked against the code)

**Needs:** Node 20+, Docker, [`mkcert`](https://github.com/FiloSottile/mkcert). Slack requires HTTPS redirect URLs, so only the Vite dev server uses HTTPS; Express stays plain HTTP behind its proxy.

```bash
mkcert -install && mkcert localhost            # localhost.pem + localhost-key.pem in the repo root (git-ignored)
docker compose up -d                           # postgres :5432, redis :6380 (AOF, noeviction), elasticsearch :9200

cd backend
cp .env.example .env                           # fill in Google / Slack / ENCRYPTION_KEY
npm install
npx prisma migrate dev
npm run dev:api                                # http://localhost:4000 (private; reached via the Vite proxy)
npm run dev:worker                             # emails + search-sync + notifications workers
npm run dev:session                            # dev only: prints a session cookie for curl (before Google login)

cd ../frontend
npm install
npm run dev                                    # https://localhost:5173  (Bull Board: /admin/queues)
```

### Environment

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` / `REDIS_URL` / `ELASTICSEARCH_URL` | | Infra |
| `APP_URL` | `https://localhost:5173` (prod: `https://rottom.your-domain.com`) | The one public origin: redirects, Google callback, `Origin` check, cookie flags |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | | Google login |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | | Slack connect |
| `SLACK_REDIRECT_URI` | `https://localhost:5173/api/slack/callback` | Must match a URL registered in the Slack app |
| `ENCRYPTION_KEY` | 32 random bytes, base64 | Encrypts webhook URLs, tokens, SMTP passwords |
| `RATE_LIMIT_MODE` | `per_sender` | or `global` |
| `WORKER_CONCURRENCY` | `5` | Parallel jobs per worker |
| `WORKER_QUEUES` | `emails,search-sync,notifications` | Which queues this worker process runs |
| `MIN_DELAY_BETWEEN_SENDS_MS` | `2000` | Minimum delay |
| `MAX_EMAILS_PER_HOUR` / `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Hourly caps |
| `RATE_LIMIT_WINDOW_MS` | `3600000` | `60000` for the demo |
| `SMTP_MODE` | `ethereal` | `fake` for load tests (nothing sent) |
| `DEFAULT_SENDERS_PER_USER` / `MAX_SENDERS_PER_USER` | `2` / `5` | Ethereal mailboxes per user |

### Ethereal

Nothing to set up: the first time a user opens Compose, the backend creates 2 Ethereal mailboxes for them (`nodemailer.createTestAccount()`), and "Add sender" creates more. Every sent email has a preview link (Ethereal keeps messages for a few hours). Details: [docs/08](./docs/08-senders-ethereal.md).

### Google and Slack apps

- **Google:** a Web OAuth client with redirect `https://localhost:5173/auth/google/callback` (+ the production one). Testing mode, with test users added.
- **Slack:** an app with Incoming Webhooks on, redirect `https://localhost:5173/api/slack/callback` (+ the production one), scope `incoming-webhook`. If Slack refuses `localhost`, use the relay page in docs/06.

Step by step: [docs/06](./docs/06-auth-slack.md).

## Assumptions, shortcuts and trade-offs

- **Ethereal only:** nothing reaches real inboxes. Messages expire after a few hours, but the audit log keeps the SMTP reply as proof.
- **One "From" sender per campaign.** Subject and body are the same for every lead (no personalization).
- **At-most-once delivery + crash check:** a duplicate cold email is worse than a missed one. An email left unresolved after a crash shows as "Needs check" with Retry send.
- **Hourly windows** are aligned to the clock (UTC). A send counts against the hour when its slot is booked, so a later failure still counts (errs on the safe side).
- **If Redis loses data,** the current window's counters can reset (a few extra sends possible). Jobs are rebuilt from Postgres.
- **ES lags ~1s** for findability. Tabs read Postgres, so statuses are always exact.
- **Global mode** pauses the whole queue and its alert goes to the owner of the email that reached the limit. Per-sender mode has no system-wide ceiling.
- **No automatic cleanup** of old audit events or jobs beyond BullMQ age limits (no cron).
- **Hosting:** one origin. Caddy (prod) and the Vite proxy (local) forward `/api`, `/auth` and `/admin` to a private API, so there's no CORS and no public API hostname. Production adds one new GoDaddy record and leaves the domain's existing sites untouched.
- **Local HTTPS uses mkcert for now** (only because Slack needs HTTPS redirects). A relay page or a real certificate on `local.your-domain.com` is the later fix.
- **Sessions:** a Redis-backed random ID cookie (`__Host-` prefix on https). Logout really ends the session.
- **Skipped on purpose:** hash-chained audit, sender rotation, per-sender limit column, "limit cleared" Slack messages, sending through users' Gmail.

All decisions with alternatives: [docs/02](./docs/02-design-decisions.md). Sources and research data: [docs/references.md](./docs/references.md).

## Deployment (optional, after the demo)

Planned: a single AWS EC2 (`ap-south-1`) running the same Docker Compose stack plus Caddy (automatic HTTPS) on one new subdomain. Only ports 80/443 are public. Steps, Caddyfile, security group and the reasons for not using managed services yet: [docs/11](./docs/11-deployment-aws.md).

_Live URL: to be added if deployed._

## Demo video

_Link to be added (≤ 5 min): login → Slack connect → schedule → send → restart → rate limit + Slack → search._
