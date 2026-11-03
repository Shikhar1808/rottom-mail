# 10 · Timeline and checklist

**Deadline:** submission on **Tue 2026-11-03** (end of day assumed). Today is Mon 2026-11-02.

**Priorities:**
- **P0:** required by the assignment. Must ship.
- **P1:** our design upgrades. Ship if on time.
- **P2:** nice to have. Cut first.

**Time budget:** about 18–20 focused hours. That's tight, so build in this order and keep each block testable.

## Blockers (do first, they involve waiting on other services)

- [ ] **Figma link:** missing from the assignment text. Ask for it or find it, or the frontend matches the layout only roughly
- [ ] **Google Cloud:** OAuth client (Web), redirect URIs, consent screen in Testing, test users (you + reviewers)
- [ ] **Slack app:** create app, enable Incoming Webhooks, HTTPS redirect URLs, scope `incoming-webhook`
- [ ] **Local HTTPS (Vite only):** `mkcert -install` + `mkcert localhost`. Check that Slack's settings accept `https://localhost:5173/api/slack/callback`. If not, use the GitHub Pages relay page ([06](./06-auth-slack.md#local-dev-and-slack))
- [ ] **Pick the production subdomain** (an unused one, e.g. `rottom`). Nothing else on GoDaddy changes

## Day 1 (Mon 11-02, evening): foundations (~5h) ✅ done

**Block A: setup (1h)**
- [x] P0 `backend/`, `docker-compose.yml` (postgres, redis with AOF + `noeviction` on host port 6380, elasticsearch single node). `frontend/` is created in the frontend block
- [x] P0 `backend/.env.example`, zod-parsed `config.ts`
- [x] P0 ESLint no-cron guard + `build = eslint src && tsc`
- [x] P0 Prisma schema (User, Sender, Campaign, Email, SlackIntegration, AuditEvent) + first migration
- [x] P1 Audit append-only trigger migration

**Block B: core scheduler (3h)**
- [x] P0 `updateEmail()` helper (row + version + audit in one transaction, sync job after commit)
- [x] P0 Senders option B: `GET/POST /api/senders`, `createTestAccount`, encryption helper, provisioning lock
- [x] P0 `POST /api/campaigns`: zod, transaction, `addBulk` (jobId, delay, attempts, backoff, retention)
- [x] P0 Worker: status check, atomic claim, pooled nodemailer, fixed Message-ID, record sent / failed
- [x] P0 Startup repair (Redis lock, batches)
- [x] P0 Bull Board at `/admin/queues` (read-only)
- [x] P1 Graceful shutdown (`worker.close()` on SIGTERM), `WORKER_QUEUES`

**Block C: first check (1h)**
- [x] P0 Schedule 5 emails 1 min ahead via curl (`npm run dev:session` cookie). All sent through Ethereal with preview links; duplicate lead merged; audit trail scheduled → claimed → sent
- [x] P0 Restart test: scheduled +2 min, killed API + worker, restarted Redis (3 delayed jobs survived), restarted API (repair) + 2 workers. Each sent exactly once
- [x] P1 Review fixes: 8 tries + repair replaces dead jobs, no SMTP reply → `needs_check`, late `sent` still recorded, `campaignId` from the form (resubmit-safe). `tests/integration/delivery.test.ts` covers the race, SMTP replies, late sent, repair and double submit

## Day 2 (Tue 11-03, morning): limits, auth, Slack, search (~6h)

**Block D: rate limiting (2h)** ✅ done
- [x] P0 Per-sender: `reserveSlot` Lua, book-and-step-aside, overflow to the next window, `hitLimit`. Live run (15 leads, cap 5, 60s window, `SMTP_MODE=fake`): 5 per window, 2s apart, same order every window, one alert job per window
- [x] P0 Global: BullMQ limiter + hourly counter + `queue.rateLimit()` + `RateLimitError`. Live run: gaps between sends 1.93–2.07s, strict order lead01 → lead15, queue paused between windows
- [x] P0 `RATE_LIMIT_MODE` switch, `RATE_LIMIT_WINDOW_MS` for the demo
- [x] P1 SMTP replies: 4xx → next window (`smtp_deferred`), 5xx → failed, 535 → sender broken, no reply → `needs_check`
- [x] P1 vitest: limiter spacing / limit once / order / parallel callers / global gate (`tests/integration/limiter.test.ts`)
- [x] Found: `localhost` in the DB URL stalls every new Postgres connection ~2s on Windows (IPv6 tried first) and made claims time out in bursts. `.env` uses `127.0.0.1`

**Block E: auth (1.5h)** ✅ backend done (real sign-in waits for the Google client ID)
- [x] P0 Google OAuth (state + PKCE, verify ID token, upsert by `sub`). Checked with a dummy client: redirect has PKCE S256, wrong/missing state → `/login?error=state`, cancel → `error=cancelled`, bad code → `error=google`
- [x] P0 Redis sessions, `requireAuth`, `/api/me`, logout (audited `login` / `logout`)
- [x] P0 Vite proxy for `/api` `/auth` `/admin` (one origin, no CORS) + `Origin` check middleware
- [x] P1 Cookie names/flags follow `APP_URL` (`__Host-sid`, `__Host-g_oauth`, `Secure` on https)

**Block F: Slack (1.5h)**
- [x] P0 Connect / callback (single-use state tied to the user, `oauth.v2.access`, encrypted upsert). Checked: forged state, another user's state and a reused state all → `?slack=error`; real slack.com rejects a fake code (`invalid_code`)
- [x] P0 `notifications` queue + limit-reached message (Block Kit, escaping, `<!date>`)
- [x] P0 Disconnect (`auth.revoke` + delete), skip when not connected, permanent error → broken. Checked: a made-up webhook got Slack's `404 no_team` → marked broken
- [x] P1 "Connected" test message
- [x] P1 Dev-only `npm run dev:slack-webhook <url>` to test alerts without OAuth
- [ ] P0 A real message in a real channel (needs the Slack app or a real webhook URL)

**Block G: search (1h)**
- [x] P0 Index mapping on boot, `search-sync` worker (version_type external, 409 = ok), campaign bulk job, repair re-queues rows with `indexedVersion < version` (first boot indexed the 68-email backlog, 0 failures)
- [x] P0 `GET /api/emails/search`: ES finds IDs, Postgres shows rows. Checked: exact address, prefix while typing, typo in a subject, status filter, another user sees nothing, ES stopped → 503 while the tabs still answer

## Day 2 (Tue 11-03, afternoon): frontend (~4h)

- [x] P0 Vite + React + Tailwind + Router + TanStack Query setup, `api/client.ts`, types
- [x] P0 UI kit (`components/ui.tsx`: Button, Field, StatusBadge, Spinner, EmptyState; native `<dialog>`; sonner toasts)
- [x] P0 Login page (Continue with Google, error toasts) + a dev-only "Dev login" (`DEV_LOGIN=true`)
- [x] P0 Header: avatar (no-referrer, initials fallback), name, email, logout
- [x] P0 Dashboard: Scheduled / Sent tabs, shared `EmailTable`, loading + empty states, 5s polling
- [x] P0 Compose (makes `campaignId = crypto.randomUUID()` when opened): From dropdown, subject, body, CSV/txt upload → `extractEmails` count, start time, delay, hourly limit, Schedule
- [x] P0 Slack button (connect / connected / reconnect) + `?slack=` toasts
- [x] P0 Search bar → results table
- [x] P1 "Needs check" badge + Retry send button
- [x] P2 History (audit timeline) as a dialog
- [ ] P2 Pixel-match the Figma (no Figma link yet)
- [x] Checked in headless Chrome at desktop and phone width: dev login → tabs → search → history → Compose with a CSV (duplicate + upper-case address merged) → 3 real Ethereal sends with preview links

## Day 2 (Tue 11-03, evening): hardening, docs, video, submit (~3h)

- [x] P1 Option C check: IMAP Message-ID search in INBOX (live-tested), in the crash path and on Retry send. "Not found" is trusted only under 1 hour; otherwise `needs_check`, and Retry asks before "Send anyway"
- [ ] P1 `SMTP_MODE=fake` + load script (1000 leads), run both modes, record numbers
- [ ] P1 vitest: `extractEmails` (same job twice sends once: done in `tests/integration/delivery.test.ts`)
- [ ] P0 README: check every run command against the real code, fill in the measured numbers, link the video
- [ ] P0 Record the demo video (script below)
- [ ] P0 Submit (checklist below)

## Local test checklist (before recording or deploying)

- [ ] `docker compose up -d` (postgres, redis, elasticsearch)
- [ ] Google login on `https://localhost:5173`: header shows name, email, avatar. Logout works
- [ ] Compose: CSV count, schedule 5 emails +1 min. They send, Ethereal previews open, Sent tab updates
- [ ] **Restart:** schedule +2 min, stop API + worker (+ `docker restart redis`), start. Each sends once, on time
- [ ] **Rate limit:** 60s window, cap 5, 15 leads. 5 sent, 10 moved in order. Repeat with `RATE_LIMIT_MODE=global`
- [ ] **Slack:** alert via the dev webhook, then Connect / Disconnect / Reconnect. No crash when not connected
- [ ] Search box finds emails. Bull Board shows the queues
- [ ] `SMTP_MODE=fake` load test with 1000 leads
- [ ] `npm run build` passes (includes the no-cron lint)

## After the submission is safe (P2)

- [ ] P2 **Deploy to AWS (2–3h):** EC2 + Elastic IP, new GoDaddy A record, security group, Caddyfile, compose up with `--scale worker=2`, prod OAuth redirect URIs, smoke test ([11](./11-deployment-aws.md)). Add the live URL to the README
- [ ] P2 Replace mkcert with the relay page or `local.your-domain.com` + a real certificate ([06](./06-auth-slack.md#local-dev-and-slack))

## Cut line (if behind, drop in this order)

1. P2 AWS deployment and the mkcert replacement (the assignment only needs local + video)
2. P2 Figma pixel-matching, then the history drawer
3. ~~P1 Option C IMAP check~~ (done)
4. P1 load script numbers (keep `SMTP_MODE=fake` and explain the expected behaviour)
5. P1 extra tests (keep the limiter tests)
6. **Never cut:** anything P0, encryption of secrets, `Origin` check, the no-cron guard

## Demo video script (≤ 5 min)

- [ ] 0:00–0:30 Login with Google. Header shows name, email, avatar
- [ ] 0:30–1:00 Connect Slack. The ✅ test message appears in the channel
- [ ] 1:00–1:45 Compose: upload CSV (count shown), start +1 min, delay 2s, hourly limit. Schedule. Scheduled tab fills
- [ ] 1:45–2:30 Bull Board shows delayed jobs. Emails send, Sent tab updates, Ethereal preview opens
- [ ] 2:30–3:30 **Restart:** schedule +2 min, stop the API + worker (and `docker restart redis`), start again. They send on time, once (Bull Board counts, audit)
- [ ] 3:30–4:30 **Rate limit:** `RATE_LIMIT_WINDOW_MS=60000`, cap 5, 15 leads. 5 send, live Slack alert, 10 moved to the next minute in order. Switch to `global` and show the paused queue
- [ ] 4:30–5:00 Search box + one email's audit timeline

## Submission checklist

- [x] Private GitHub repo (`Shikhar1808/rottom-mail` is private)
- [ ] Add collaborators **Mitrajit** and **Yadav036** (GitHub → Settings → Collaborators → Add people)
- [ ] README sections:
  - [ ] how to run backend + worker + Redis/DB/ES
  - [ ] how to run frontend
  - [ ] Ethereal + env setup
  - [ ] architecture (scheduling, persistence, rate limiting & concurrency)
  - [ ] features mapped to requirements
  - [ ] assumptions / trade-offs
- [ ] README states the chosen delay and limit ("at least 2s between sends, 200/hr per sender")
- [ ] Demo video link (≤ 5 min) in the README
- [ ] Live URL in the README (only if the P2 deployment happened)
- [ ] `.env.example` committed, no secrets in git
- [ ] Reviewers added as Google OAuth test users (if they will run it)
