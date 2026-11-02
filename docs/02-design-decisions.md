# 02 · Design decisions

Every decision made during the design discussion. Each one records the options weighed, what was chosen and why, and the trade-off. The topic docs hold the details.

**Status:** ✅ Decided · 🟡 Recommended, not yet confirmed · ❓ Open

| # | Topic | Decision | Status |
|---|---|---|---|
| D1 | Frontend | Vite + React + TS + Tailwind | ✅ |
| D2 | Database | Postgres + Prisma | ✅ |
| D3 | Hosting | Subdomains `app.` + `api.` of one domain | ✅ |
| D4 | Login | Google OAuth on the backend, state + PKCE | ✅ |
| D5 | Sessions | Random session ID cookie, session stored in Redis | 🟡 |
| D6 | Local HTTPS | `mkcert`, with a tunnel as fallback | 🟡 |
| D7 | Slack connect | OAuth v2 `incoming-webhook`, encrypted, single-use state tied to the user | ✅ |
| D8 | Slack messages | "Connected" + "limit reached" (per-sender / global) | ✅ |
| D9 | Senders | Ethereal mailboxes auto-created per user (option B) | ✅ |
| D10 | Rate limiting | Two implementations: global and per-sender (`RATE_LIMIT_MODE`) | ✅ |
| D11 | Per-sender waiting | Book a slot and step aside, never sleep | ✅ |
| D12 | SMTP replies | 4xx means try later, 5xx means failed | ✅ |
| D13 | Scheduling | BullMQ delayed jobs, `jobId = email.id` | ✅ |
| D14 | Persistence | Postgres as truth, Redis AOF + `noeviction`, startup repair | ✅ |
| D15 | Delivery guarantee | At-most-once + Option C (check, then resend) | ✅ |
| D16 | Failures | Retries / `failed` set = DLQ, "Needs check" + Retry send | ✅ |
| D17 | No cron | Enforced by ESLint, build fails if broken | ✅ |
| D18 | ES sync | `search-sync` queue, outbox-style, version check | ✅ |
| D19 | Read paths | Tabs from Postgres. Search: ES finds, Postgres shows | ✅ |
| D20 | Audit | Append-only audit trail, no hash chain | ✅ |
| D21 | Bull Board | Read-only, behind login, keeps recent completed jobs | ✅ |
| D22 | Scaling | Workers per queue, graceful shutdown, `SMTP_MODE=fake` for load tests | ✅ |
| O1 | Compose fields | Form = plan, env caps = guard (two layers) | ❓ |
| O2 | Sender rotation | One "From" per campaign for v1 | ❓ |
| O3 | Per-sender limit column | One env cap for v1 | ❓ |
| O4 | Figma | Link needed before pixel-matching | ❓ |

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

### D3 · Hosting: subdomains of one domain ✅
- **Options:**
  1. proxy, so the browser sees one domain
  2. **subdomains** `app.mysite.com` + `api.mysite.com`
  3. completely different sites (`*.vercel.app` + `*.onrender.com`)
- **Chosen:** 2.
- **Why:** the subdomains count as the *same site*, so `SameSite=Lax` cookies work. Option 3 makes the session a third-party cookie, which Safari blocks by default and Firefox isolates, so login breaks there.
- **Cost:** CORS with `credentials: true` and the exact origin, `fetch(..., { credentials: 'include' })`, and an `Origin` check on writes (any `*.mysite.com` counts as same-site).
- **Details:** [06 · Auth & Slack](./06-auth-slack.md#hosting-setup-2-subdomains)

### D4 · Login: Google OAuth on the backend ✅
- **Options:** backend redirect flow · frontend Google button + ID token · NextAuth · "Sign in with Slack".
- **Chosen:** Authorization Code flow handled by Express (`google-auth-library`) with **state** (stops forged logins) and **PKCE S256** (stops a stolen code from being used). Both are kept in a 10-minute httpOnly cookie. The ID token is verified (signature, audience, expiry, `email_verified`), and users are upserted by Google `sub`.
- **Why not Slack login:** the assignment requires Google. Slack login only gives identity, not posting permission. And neither provider fixes cross-domain cookies, because OAuth only covers the login moment, not the session after it.
- **Details:** [06](./06-auth-slack.md#google-login)

### D5 · Sessions: Redis-backed session cookie 🟡
- **Options:** JWT in a cookie · random session ID cookie with the session in Redis.
- **Recommended:** Redis sessions (`sess:<id>`, 7-day TTL).
- **Why:** logout really ends the session, while a stolen JWT keeps working until it expires. Redis is already in the stack, AOF keeps sessions through restarts, and no JWT library is needed.

### D6 · Local HTTPS: mkcert 🟡
- **Why HTTPS:** Slack requires HTTPS redirect URLs. Chrome treats `http` and `https` as different sites, so frontend and backend must use the same scheme.
- **Recommended:** `mkcert` for `https://localhost:5173` + `https://localhost:4000`. If Slack's settings refuse `localhost`, use a `cloudflared` / `ngrok` tunnel.

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
- **How C works:** every send uses a fixed `Message-ID: <email.id@reachinbox.local>`. If a job finds its row already `sending` (a crash), it searches the sender's Ethereal mailbox over IMAP for that Message-ID.
  - **Found:** mark it `sent`.
  - **Not found:** send it.
  - **Check fails:** mark it `needs_check`. The user can click Retry send.
- **Why:** a duplicate cold email is worse than a missed one, and the check removes the ambiguity in most cases.
- **Remaining risk:** a worker that is frozen but still alive could finish its send while the check runs. That's rare, and documented.

### D16 · Failure handling and NACK/DLQ ✅
- **Known failure** (SMTP error): retry with backoff, then the BullMQ `failed` set (that's the DLQ), and the row becomes `failed`.
- **Unknown outcome** (crash mid-send): stalled-job redelivery runs the Option C check, then `needs_check`.
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
- **Setup:** `@bull-board/express` at `/admin/queues`, behind `requireAuth`, `readOnlyMode: true` (so no unaudited retries or deletes), showing `emails` and `search-sync`.
- **Keeps recent jobs:** `removeOnComplete: { age: 86400, count: 1000 }`, so the Completed list isn't empty and re-adding a finished job's ID is ignored.

### D22 · Scaling basics ✅
- Workers scale per queue (`WORKER_QUEUES`).
- `SIGTERM` runs `worker.close()` (graceful shutdown).
- The startup repair takes a lock.
- Senders use pooled SMTP connections.
- `SMTP_MODE=fake` (nodemailer `jsonTransport`) runs load tests of 1000+ emails without hitting Ethereal.
- **Details:** [09](./09-scaling-impacts.md)

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

### O4 · Figma ❓
The Figma link was missing from the assignment text. Layout work waits on it, while the components and data flow can be built first.
