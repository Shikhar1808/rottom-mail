# 02 · Design decisions

Every decision made during the design discussion. Each one records the options weighed, what was chosen and why, and the trade-off. The topic docs hold the details.

**Status:** ✅ Decided · 🟡 Recommended, not yet confirmed · ❓ Open

| # | Topic | Decision | Status |
|---|---|---|---|
| D1 | Frontend | Vite + React + TS + Tailwind | ✅ |
| D2 | Database | Postgres + Prisma | ✅ |
| D3 | Hosting | One origin: `rottom.<domain>`. Caddy (prod) / Vite proxy (local) routes `/api` `/auth` `/admin` to the private API | ✅ |
| D4 | Login | Google OAuth on the backend, state + PKCE | ✅ |
| D5 | Sessions | Random session ID cookie, session stored in Redis | ✅ |
| D6 | Local HTTPS | mkcert on Vite only (for now). Relay page / real cert later | ✅ |
| D7 | Slack connect | OAuth v2 `incoming-webhook`, encrypted, single-use state tied to the user | ✅ |
| D8 | Slack messages | "Connected" + "limit reached" (per-sender / global) | ✅ |
| D9 | Senders | Ethereal mailboxes auto-created per user (option B) | ✅ |
| D10 | Rate limiting | Two implementations: global and per-sender (`RATE_LIMIT_MODE`) | ✅ |
| D11 | Per-sender waiting | Book a slot and step aside, never sleep | ✅ |
| D12 | SMTP replies | 4xx means try later, 5xx means failed, no reply means needs check | ✅ |
| D13 | Scheduling | BullMQ delayed jobs, `jobId = email.id` | ✅ |
| D14 | Persistence | Postgres as truth, Redis AOF + `noeviction`, startup repair | ✅ |
| D15 | Delivery guarantee | At-most-once + Option C (check, then resend) | ✅ |
| D16 | Failures | Retries / `failed` set = DLQ, "Needs check" + Retry send | ✅ |
| D17 | No cron | Enforced by ESLint, build fails if broken | ✅ |
| D18 | ES sync | `search-sync` queue, outbox-style, version check | ✅ |
| D19 | Read paths | Tabs from Postgres. Search: ES finds, Postgres shows | ✅ |
| D20 | Audit | Append-only audit trail, no hash chain | ✅ |
| D21 | Bull Board | Read-only, admins only, keeps recent completed jobs | ✅ |
| D22 | Scaling | Workers per queue, graceful shutdown, `SMTP_MODE=fake` for load tests | ✅ |
| D23 | Ethereal's own limit | Not relied on: our Redis limiter first, Ethereal's 4xx as a backstop | ✅ |
| D24 | Deployment | Single EC2 + Docker Compose + Caddy, after the local demo | 🟡 |
| D25 | Cookie names | `__Host-` prefix when served over https | 🟡 |
| D26 | Open to the public | Own data only, admin-only Bull Board, per-user waiting cap, privacy page | ✅ |
| D27 | UI | The Figma's layout and green, plus our own touch: pixel ROTTOM wordmark and airmail edge | ✅ |
| D28 | Message body | Formatted (HTML + plain text) with up to 3 attachments, 2 MB in total, at demo scale | ✅ |
| O1 | Compose fields | Form = plan, env caps = guard (two layers) | ❓ |
| O2 | Sender rotation | One "From" per campaign for v1 | ❓ |
| O3 | Per-sender limit column | One env cap for v1 | ❓ |
| O4 | Figma | Resolved: screenshots provided, see D27 | ✅ |

---

### D1 · Frontend: Vite + React ✅
- **Options:** Vite + React SPA · Next.js (NextAuth).
- **Chosen:** Vite + React + TS + Tailwind + React Router + TanStack Query + `sonner`.
- **Why:** the backend owns auth (Google and Slack use the same redirect pattern), so a Next.js server adds nothing. TanStack Query provides loading, error and polling states without extra code.
- **Trade-off:** no server-side rendering, which a logged-in dashboard doesn't need.

### D2 · Database: Postgres + Prisma ✅
- **Options:** Postgres + Prisma · Postgres + Drizzle · MySQL + Prisma.
- **Chosen:** Postgres + Prisma.
- **Why:** schema, migrations and types with almost no setup. `updateMany({ where: { id, status: 'scheduled' } })` gives the atomic claim. Raw SQL migrations cover the audit trigger.

### D3 · Hosting: one origin ✅ (changed)
- **Options:**
  1. **one origin**, with a proxy routing paths to the API
  2. subdomains `app.` + `api.`
  3. completely different sites (`*.vercel.app` + `*.onrender.com`)
- **Chosen:** 1. Production uses one new GoDaddy A record for an unused subdomain (e.g. `rottom.your-domain.com`). Caddy forwards `/api`, `/auth`, `/admin` to the private `api:4000` and serves the built frontend for everything else. Locally, the Vite dev proxy does the same.
- **History:** first chose 2 (same site, so cookies work). Switched because the user didn't want a public `api.` hostname, and with Caddy on one EC2, one origin is *simpler*: no CORS, no `credentials: 'include'`, first-party cookies.
- **Option 3 rejected:** the session would be a third-party cookie, which Safari blocks and Firefox isolates, so login breaks there.
- **Kept:** the `Origin` check on writes, as cheap CSRF protection.
- **Details:** [06 · Auth & Slack](./06-auth-slack.md#hosting-one-origin), [11 · Deployment](./11-deployment-aws.md)

### D4 · Login: Google OAuth on the backend ✅
- **Options:** backend redirect flow · frontend Google button + ID token · NextAuth · "Sign in with Slack".
- **Chosen:** Authorization Code flow handled by Express (`google-auth-library`) with **state** (stops forged logins) and **PKCE S256** (stops a stolen code from being used). Both are kept in a 10-minute httpOnly cookie. The ID token is verified (signature, audience, expiry, `email_verified`), and users are upserted by Google `sub`.
- **Why not Slack login:** the assignment requires Google. Slack login only gives identity, not posting permission. And neither provider fixes cross-domain cookies, because OAuth only covers the login moment, not the session after it.
- **Details:** [06](./06-auth-slack.md#google-login)

### D5 · Sessions: Redis-backed session cookie ✅
- **Why sessions at all:** OAuth only covers the login moment. Google's ID token lasts about 1 hour and can't be revoked, so the app needs its own session.
- **Options:** Google's token · our own JWT cookie · **Redis session** · Postgres session table · in-memory.
- **Chosen:** Redis sessions (`sess:<id>`, 7-day TTL). The cookie holds only a random 256-bit ID.
- **Why:**
  - logout really ends the session (delete the key), while a stolen JWT keeps working until it expires
  - expiry is automatic (TTL), while a Postgres table would need a cleanup job, which breaks no-cron
  - survives restarts (AOF) and works with several API servers
  - Redis is already in the stack, and no JWT library is needed
- **Details:** [06](./06-auth-slack.md#why-sessions-at-all)

### D6 · Local HTTPS: mkcert, for now ✅ (changed)
- **Why HTTPS locally:** only Slack needs it ("the `redirect_uri` must use HTTPS"). Google allows `http://localhost`.
- **Chosen for now:** `mkcert` on **Vite only** (`https://localhost:5173`). Vite forwards to Express over plain HTTP, the same way Caddy does in production. If Slack's settings refuse `localhost`, use the relay page.
- **Better fix later (if time allows):** an HTTPS relay page (GitHub Pages) that forwards to localhost, or `local.your-domain.com` → 127.0.0.1 with a real Let's Encrypt certificate (manual TXT record), or an ngrok static domain.
- **Rejected:** moving the GoDaddy DNS to Cloudflare for a Cloudflare Tunnel. The domain already hosts a portfolio and another project, and one missed record would break them. We only **add new** records.
- **Alerts can be tested without OAuth:** a dev-only script saves a manually created webhook.
- **Details:** [06](./06-auth-slack.md#local-dev-and-slack)

### D7 · Slack connect ✅
- **Chosen:** OAuth v2 with scope `incoming-webhook`. The user picks a workspace and channel.
  - `state` is random, **single use** (`GETDEL`), expires in 10 min, and **must match the logged-in user**. Otherwise an attacker could attach their Slack channel to your account, or yours to theirs.
  - The webhook URL and token are **encrypted** (AES-256-GCM). Slack's docs say the URL contains a secret.
  - It's never sent to the frontend and never logged.
  - Disconnect calls `auth.revoke` (best effort) and deletes the row. A permanent webhook error marks the integration **broken**, and the UI shows "Reconnect".
  - The worker reads the integration from the DB on every alert, so a reconnect works immediately with no redeploy.
- **Details:** [06](./06-auth-slack.md#slack-connect)

### D8 · Slack messages ✅
- **Chosen:**
  - ✅ "Connected" test message right after connecting
  - ⚠️ "Hourly limit reached" per sender (per-sender mode)
  - ⚠️ "System hourly limit reached" (global mode, sent to the owner of the email that hit the limit)
- **How the alert is sent:** exactly once per window. The atomic counter fires it when `count == limit`, and a `notifications` queue retries on 429/5xx.
- **Format:** Block Kit plus a plain `text` fallback. `<!date^…>` shows the time in each reader's timezone. User text is escaped (`&`, `<`, `>`) so a subject like `<!channel>` can't ping everyone.
- **Skipped:** "limit cleared" (would need a timer), daily summaries (would need cron), "campaign finished".

### D9 · Senders: auto-created Ethereal mailboxes per user (option B) ✅
- **Options:**
  - A: seeded mailboxes shared by everyone
  - **B: 2 mailboxes created per user**
  - C: user pastes credentials
- **Rules:**
  - Created the first time Compose opens with 0 working senders (login never waits on Ethereal).
  - A Redis lock prevents double creation.
  - `DEFAULT_SENDERS_PER_USER=2`, and "Add sender" goes up to 5.
  - A broken mailbox (SMTP `535`) gets marked, and new ones are created when needed.
- **Why:** each user owns their senders (tenant isolation), and reviewers don't need any setup.
- **Details:** [08](./08-senders-ethereal.md)

### D10 · Rate limiting: two implementations ✅
- **Chosen:** one codebase and a `RATE_LIMIT_MODE=global | per_sender` switch. Two small files (`limiters/global.ts`, `limiters/perSender.ts`) share everything else, so the same load test runs against both.
  - **Global:** BullMQ `limiter: { max: 1, duration: MIN_DELAY }` + a Redis hourly counter + `worker.rateLimit()` to pause the queue until the next window.
  - **Per-sender:** one atomic Lua script per sender that books the next slot and counts the hour. Jobs over the limit move to the next window in order.
- **Details and comparison:** [04](./04-rate-limiting.md)

### D11 · Per-sender: book the slot, step aside ✅
- **Problem:** sleeping until a sender's slot ties up worker slots. 1000 emails for Alice would block Bob's 10.
- **Chosen:** if the booked slot is in the future, call `job.moveToDelayed(slot)` and remember the slot in the job data. The worker is free right away. When the job wakes, it sends without booking again.

### D12 · SMTP replies: 4xx later, 5xx failed ✅
- **Why:** Ethereal public accounts reject mail above **200 messages/hour** until the next hour. Under standard SMTP rules, 4xx means temporary, so those jobs move to the next window (audit `smtp_deferred`) instead of burning retries. 5xx means permanent, so the email is `failed`.
- **No reply at all** (connection dropped or timed out): the server may already have the message, so the email becomes `needs_check` instead of being resent (at-most-once, D15).
- **Also:** keep `MAX_EMAILS_PER_HOUR_PER_SENDER ≤ 200`.

### D13 · Scheduling: BullMQ delayed jobs ✅
- **Chosen:** each email is a delayed job with `jobId = email.id` (duplicate adds are ignored) and data `{ emailId }`. Attempts: 3, exponential backoff from 5s.
- **No `setTimeout` timers:** the send time is a timestamp stored in Redis.

### D14 · Persistence and restarts ✅
- **Chosen:**
  - Postgres is the source of truth: rows are committed before jobs are queued.
  - Redis runs with `appendonly yes`, `appendfsync everysec`, `maxmemory-policy noeviction` and a volume.
  - **Startup repair:** one instance, holding a Redis lock, re-queues `scheduled` rows in batches (duplicates are ignored) and re-syncs rows where `indexedVersion < version`.
- **Details:** [03](./03-scheduling-persistence.md)

### D15 · Delivery guarantee: at-most-once + Option C ✅
- **Options:**
  - A: manual "Retry send" for stuck rows
  - B: automatic check before resending
  - **C: B, with A as the fallback**
- **How C works:** every send uses a fixed `Message-ID: <email.id@reachinbox.local>`. The check searches the sender's Ethereal INBOX over IMAP for it. It runs when a job finds its row already `sending` (a crash), and when the user clicks Retry send on a `needs_check` email.
  - **Found:** mark it `sent`. Nothing is sent again.
  - **Not found, attempt under an hour old:** send it.
  - **Not found but older, or the check fails:** can't tell, because Ethereal deletes messages after a few hours. After a crash the row becomes `needs_check`. On Retry, the UI spells out the risk of a second copy and sends only if the user clicks "Send anyway".
- **Why:** a duplicate cold email is worse than a missed one, and the check removes the ambiguity in most cases.
- **Remaining risk:** a worker that is frozen but still alive could finish its send while the check runs. That's rare, and documented. If it does, its `sent` result still lands (that write also accepts `needs_check`), so the only gap left is a user clicking Retry send before then.

### D16 · Failure handling and NACK/DLQ ✅
- **Known failure** (SMTP error): retry with backoff, then the BullMQ `failed` set (that's the DLQ), and the row becomes `failed`.
- **Unknown outcome** (crash mid-send): stalled-job redelivery runs the Option C check, and the row becomes `needs_check` only if the check can't tell. No SMTP reply parks as `needs_check` straight away, and Retry send runs the check.
- **Rate limit:** "not now". `DelayedError` / `RateLimitError` don't use up an attempt.
- **Replays:** go through our audited `POST /api/emails/:id/retry`, not Bull Board.
- **Details:** [03](./03-scheduling-persistence.md#failure-handling-vs-nack-and-dlq)

### D17 · No cron, checked by ESLint ✅
- **Banned:** `node-cron`, `cron`, `croner`, `node-schedule`, `agenda`, `bree`, `setInterval`, and BullMQ's `repeat` / `upsertJobScheduler`. ESLint rules enforce this, and `build = eslint src && tsc`, so the build fails if any of them sneak in.
- **Allowed:** short `setTimeout` waits inside a job, and BullMQ's internal stalled check (inside the library).
- **Details:** [03](./03-scheduling-persistence.md#no-cron)

### D18 · Elasticsearch sync: queue, outbox-style ✅
- **Options:** write to ES directly from the app (dual write) · **sync queue with versions** · CDC (Debezium).
- **Chosen:** `updateEmail()` bumps `version` in the same transaction as the change and then queues a `search-sync` job. The job reads the **latest** row and writes it with `version_type: external`, so ES rejects stale writes and a 409 counts as success.
- **Why:** if ES is down, sending is never blocked, and nothing is lost: the startup repair catches up rows where `indexedVersion < version`. Dual writes lose updates without any warning when ES is down.
- **Details:** [05](./05-search-elasticsearch.md)

### D19 · Read paths ✅
- **Tabs read from Postgres:** always exact and instant.
- **Search: ES finds the IDs, Postgres shows the rows.** Borrowed from GitLab, which loads its ES hits back from Postgres and checks permissions there. Statuses are never stale, and `userId` is checked a second time.
- **Research:** GitLab serves even searches typed into its issue list from Postgres (2,225,967 requests in 7 days, zero to ES). Mailgun reads everything from ES, but its data is an append-only event log kept 30 days, which doesn't fit our rows that change status.

### D20 · Audit trail, no hash chain ✅
- **Chosen:** an append-only `AuditEvent` table, written **in the same transaction** as every change through `updateEmail()`. A DB trigger blocks UPDATE/DELETE. There's a history timeline per email.
- **Hash chain (HMAC per email):** considered and **skipped**. Email-sending services keep event logs, not hash-chained ones. Tamper-proof logs matter for regulated archiving (e.g. WORM storage) and cloud audit logs, not for a scheduler.
- **Details:** [07](./07-audit-observability.md)

### D21 · Bull Board ✅
- **Setup:** `@bull-board/express` at `/admin/queues`, behind `requireAuth` + `requireAdmin` (only `ADMIN_EMAILS`, because it shows every user's jobs), `readOnlyMode: true` (so no unaudited retries or deletes), showing `emails` and `search-sync`.
- **Keeps recent jobs:** `removeOnComplete: { age: 86400, count: 1000 }`, so the Completed list isn't empty and re-adding a finished job's ID is ignored.

### D22 · Scaling basics ✅
- Workers scale per queue (`WORKER_QUEUES`).
- `SIGTERM` runs `worker.close()` (graceful shutdown).
- The startup repair takes a lock.
- Senders use pooled SMTP connections.
- `SMTP_MODE=fake` (nodemailer `jsonTransport`) runs load tests of 1000+ emails without hitting Ethereal.
- **Details:** [09](./09-scaling-impacts.md)

### D23 · Don't rely on Ethereal's own 200/hr limit ✅
- **Question raised:** Ethereal already limits public accounts to 200/hour and keeps messages for a while. Do we still need a Redis limiter?
- **Yes**, because Ethereal's limit:
  - isn't configurable via env
  - has no minimum delay between sends
  - knows nothing about campaign limits
  - **rejects** instead of rescheduling to the next hour in order
  - gives no signal "the moment the limit is reached" for Slack (we'd only find out after a bounce)
  - and the assignment explicitly requires Redis/DB counters that are safe across workers
  - It also doesn't exist in `SMTP_MODE=fake`, and every real provider has different rules.
- **Real world:** senders throttle *before* the provider's limit. Repeated limit hits are treated as abuse and can get a mailbox suspended.
- **Role of Ethereal's limit:** a backstop. If it's ever reached (e.g. one sender in global mode), SMTP 4xx moves the email to the next window.
- **Ethereal's storage** is a preview inbox (a few hours), not a job store. Schedules live in Postgres + Redis.
- **Details:** [04](./04-rate-limiting.md#why-not-just-rely-on-ethereals-limit)

### D24 · Deployment: single EC2 + Docker Compose + Caddy 🟡
- **Options:** **one EC2 running the same compose stack + Caddy** · managed (S3/CloudFront, ECS, RDS, ElastiCache, OpenSearch, ALB).
- **Recommended:** one EC2 (t3.medium+, `ap-south-1`) with an Elastic IP and one new GoDaddy A record. Caddy provides automatic Let's Encrypt. Only 80/443 are public (22 from your IP).
- **When:** **after** the local demo is recorded (P2).
- **Why not managed now:**
  - AWS's search is **OpenSearch**, which the `@elastic/elasticsearch` client rejects
  - ElastiCache defaults to an **evicting** memory policy (needs `noeviction`), and its persistence differs from AOF
  - wiring VPC, ECS, ALB and ACM takes too long for the deadline
- **Details:** [11](./11-deployment-aws.md)

### D25 · `__Host-` cookie prefix 🟡
- **Why:** with a domain that hosts other sites, a compromised sibling subdomain could plant a cookie for the whole domain ("cookie tossing"), e.g. a fake session or a fake `g_oauth`. Browsers only accept a `__Host-` cookie if it's `Secure`, has `Path=/` and has no `Domain`, so siblings can't create one.
- **How:** `__Host-sid` and `__Host-g_oauth` (path `/`) when `APP_URL` is https. Plain `sid` / `g_oauth` on `http://localhost`.
- **Details:** [06](./06-auth-slack.md#whats-in-the-cookies)

### D26 · Open to the public ✅
- **Goal:** anyone with a Google account can use the production site, so users must not trust each other.
- **Own data only:** every query is filtered by the session's `userId` (tabs, search, history, retry, senders, Slack). `tests/integration/access.test.ts` checks it through the real app.
- **Bull Board, admins only:** it can't filter by user, so only the Google emails in `ADMIN_EMAILS` can open it. The email is safe to trust because login only accepts verified Google emails. Options: an IP allowlist in Caddy (breaks on a changing home IP), a separate password (one more secret), or hiding it entirely in production (loses the live dashboard).
- **Per-user cap:** at most `MAX_PENDING_EMAILS_PER_USER` (20,000) emails waiting per user. A campaign that would go over is refused with 429, and nothing is saved. A per-user Postgres lock (`pg_advisory_xact_lock`) makes the count exact, so parallel submits can't pass the cap together. Each campaign is still capped at 10,000 leads.
- **Privacy policy** at `/privacy`, linked from the login page. Google requires one before the app can leave "Testing". It's honest about the audit log being permanent.
- **Spam:** not a risk, because every email goes to Ethereal, which never delivers to real inboxes.
- **Not done:** no per-IP request limit on the API, and no self-service account deletion (by request instead).

### D27 · UI: the Figma, plus our own touch ✅
- **Goal:** look like the given Figma, with something of our own. Three directions were mocked up; the user picked A.
- **Kept from the Figma:** the login card, the sidebar (wordmark, profile card, outlined Compose, "CORE" with Scheduled / Sent and counts), the search bar with filter and refresh, inbox rows ("To:", an orange clock pill with the send time, bold subject and a grey preview), the email page, and compose (From / To / Subject rows, delay and hourly limit, a grey message box, the clock with its "Send Later" menu, "Send" / "Send Later").
- **Our touch:** a pixel **ROTTOM** wordmark (in the place of their pixel "ONB") and the red-and-blue **airmail edge** on top of every page. The green is a shade darker than the Figma's, so white text on it and green text on white pass WCAG AA contrast. "Send Later" adds "In 1 minute" and "In 5 minutes", which suit a live demo.
- **Left out on purpose:** email/password login (the app only signs in with Google), star, archive, delete and attachments (no such features: a button that does nothing would look broken), and the rich-text toolbar (emails go out as plain text).
- **Added where the Figma has no place for it:** the profile card's arrow opens a menu with Slack connect / disconnect, the queue dashboard (admins only) and logout. Failed and "Needs check" rows get a Retry button. The email page shows the status, an "Open in Ethereal" link, Retry, and the email's history timeline (it replaced the History popup).
- **API for it:** row previews, `GET /api/emails/counts`, `GET /api/emails/:id`, a `status` filter on the Sent tab, and `isAdmin` on `/api/me`.

### D28 · Formatted messages and attachments ✅
- **Asked for:** "anything Ethereal supports", at demo scale. Ethereal shows HTML email and attachments in its preview.
- **Editor:** the Figma's toolbar works: undo / redo, text size, bold, italic, underline, strikethrough, align, lists, indent, quote and links. It uses the browser's own editing (`document.execCommand`), so there's no editor library to install. The API is marked deprecated but works in every browser (a `shortcut:` comment in `Editor.tsx`). Pasted text arrives plain, so styles from Word or web pages stay out of the emails. Links must be web or mail addresses (`javascript:` and the like are refused).
- **Sending:** every email carries the HTML, a plain-text version (for mail apps that don't show formatting; also used for previews and search) and the attachments.
- **Attachments:** up to **3 files, 2 MB in total**, checked in the form and again by the API. They live in Postgres (`Attachment`, `bytea`) and the worker reads them for each send. The same files go with every email and an Ethereal mailbox holds about 100 MB, so this fits a demo (2 MB × 30 leads = 60 MB), not a 200-lead campaign with full-size files.
- **Safety in the app:** the email page shows the HTML in a sandboxed `<iframe>` without `allow-scripts`, so nothing in a message can run in the app. Checked in the browser with an `onerror` image, a `<script>` and a `javascript:` link.
- **Not done (demo level):** pictures inside the text, fonts and colours, tables, downloading attachments from the app (Ethereal's preview has them), and a per-campaign cache of the files in the worker.

---

## Open questions

### O1 · What do the compose form's Delay and Hourly limit control? ❓
**Recommendation:** two layers, the same in both modes.
1. **Plan (form values):** when scheduling, each email gets its planned time: `scheduledAt[i] = startAt + floor(i / L) * max(W, L * delay) + (i % L) * delay`, where `L` is the form's hourly limit and `W` is the window. The Scheduled tab therefore shows realistic times.
2. **Guard (env caps):** at send time the limiter enforces `MAX_EMAILS_PER_HOUR` (global) or `MAX_EMAILS_PER_HOUR_PER_SENDER` (per-sender) plus `MIN_DELAY_BETWEEN_SENDS_MS`. Slack fires when a guard limit is reached.

Both modes take the same inputs, so the comparison stays clean. The alternative is to feed the form's limit straight into the per-sender limiter (`min(form, env)`).

### O2 · Sender rotation ❓
Should one campaign spread its leads round-robin across several of the user's senders? Throughput would multiply by the number of senders (about 5 lines on top of per-sender limits). **Recommendation:** one "From" per campaign for v1. Rotation is P2.

### O3 · Limit per sender ❓
Should each sender store its own `hourlyLimit` (real mailboxes differ: a new mailbox might do 50/hr, a warmed-up one 300/hr)? **Recommendation:** one env cap (≤ 200, Ethereal's limit) for v1.

### O4 · Figma ✅
Resolved on 2026-11-03: the Figma screens were shared as screenshots (login, Scheduled, Sent, email page, compose with "Send Later"). The UI follows them: [D27](#d27--ui-the-figma-plus-our-own-touch-).
