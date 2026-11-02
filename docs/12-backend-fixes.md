# 12 · Backend fixes

Every bug found in the backend so far, what it could have done, and what changed. Two code reviews found most of them: one of the Day 1 code and one of the Day 2 code. One more came up during live testing. Each fix lists where it lives now (paths after the `15f5508` restructure) and the test that would fail if it broke again.

## Summary

| # | Fix | What it prevented | Found in | Commit | Test |
|---|---|---|---|---|---|
| 1 | More email retries + repair replaces finished jobs | Emails stuck as "Scheduled" for good after a short database outage | Review 1 | `cfa8ef7` | ✅ |
| 2 | No SMTP reply → `needs_check` | One email sent twice after a dropped connection | Review 1 | `cfa8ef7` | ✅ |
| 3 | Campaign id made by the form | Every email sent twice after a double submit | Review 1 | `cfa8ef7` | ✅ |
| 4 | A late `sent` is still recorded | A delivered email shown as "Needs check", then resent on Retry | Review 1 | `cfa8ef7` | ✅ |
| 5 | Tests for the send path | Day 2 changes breaking "one send per email" unnoticed | Review 1 | `cfa8ef7` | ✅ |
| 6 | Retry events record where they came from | An empty "from" in the email timeline | Review 1 | `cfa8ef7` | — |
| 7 | `127.0.0.1` instead of `localhost` | ~2s stall on every new database connection on Windows | Live testing | `c18a2f4` | — |
| 8 | Dev login only on a localhost `APP_URL` | A no-password login on the public site | Review 2 | `78cda1f` | — |
| 9 | Tests for the OAuth "state" checks | One user's Slack connection landing on another user's account unnoticed | Review 2 | `78cda1f` | ✅ |
| 10 | Limits and window must be above 0 | All sending stopping silently on a wrong setting | Review 2 | `78cda1f` | — |
| 11 | A sender's next free slot is kept until it has passed | Two campaigns from one sender sending seconds apart | Review 2 | `78cda1f` | ✅ |
| 12 | Tests are linted again | Dead code collecting in the tests | Review 2 | `78cda1f` | — |

All 23 backend tests pass (`npm test` in `backend/`, with `docker compose up`).

## Review 1: Day 1 code (fixed in `cfa8ef7`)

### 1. Emails stuck as "Scheduled" after a short database outage

- **Problem:** An email job had 3 tries, 5s and 10s apart. When Postgres was down for about 30 seconds, every email due in that time used up its tries and ended in BullMQ's failed list. Its row still said `scheduled`. On restart, repair re-added the job under the same id, but BullMQ ignores an id it already has, failed jobs included. Retry only takes failed and needs-check rows, so the email could never be sent.
- **Fix:**
  - The `emails` queue now gives each job 8 tries. The wait doubles from 5s, so the tries cover about 10 minutes of outage.
  - Before re-adding a row that is still `scheduled`, repair removes its failed or completed job. This can't cause a double send, because the atomic claim (`scheduled → sending`) still lets only one worker send.
- **Where:** `backend/src/lib/queues.ts:19`, `backend/src/services/scheduler.ts:51-52`
- **Test:** `delivery.test.ts` › "re-queues a scheduled email whose job already failed"

### 2. A dropped connection could send the same email twice

- **Problem:** When a send failed without an SMTP reply code (such as 250 or 550), the worker put the row back to `scheduled` and the email was sent again. But the connection can drop after Ethereal has accepted the message and before its "250 OK" arrives. Nodemailer reports both cases with the same error, so the retry could deliver a second copy.
- **Fix:** No reply code now means "delivery unknown". The row goes to `needs_check`, the same as after a worker crash ([docs/03](./03-scheduling-persistence.md)). The user decides whether to retry.
- **Trade-off:** If Ethereal itself is down, emails wait in "Needs check" instead of retrying on their own, until the Option C crash check is built.
- **Where:** `backend/src/workers/emailWorker.ts:81`
- **Test:** `delivery.test.ts` › "5xx fails, 4xx moves to the next window, no SMTP reply parks as needs_check"

### 3. Submitting the same campaign twice sent every email twice

- **Problem:** Each `POST /api/campaigns` made a new random campaign id. A double-click, or a second click after a slow or failed response, created a second campaign, and every lead got the email twice.
- **Fix:**
  - The Compose form makes the campaign id once, when it opens, and sends it with the request.
  - The server inserts the campaign with `ON CONFLICT DO NOTHING` (Prisma `createMany` with `skipDuplicates`). A second submit waits for the first, adds nothing, and gets back what the first one created.
  - An id that belongs to another user returns `409`.
- **Where:** `backend/src/services/campaigns.ts:47-63, 92-103`, `frontend/src/pages/Compose.tsx:14`
- **Test:** `delivery.test.ts` › "the same form submitted twice at once creates one campaign"

### 4. A late "sent" result was thrown away

- **Problem:** After a send, the worker wrote `sent` only if the row was still `sending`. If a slow send took over 30 seconds, a second copy of the job could park the row as `needs_check` first. The `sent` write then changed nothing, with no error. The row showed "Needs check" although the email had gone out, so clicking Retry would send it again.
- **Fix:** If the row is no longer `sending`, the worker records `sent` from `needs_check` as well.
- **Where:** `backend/src/workers/emailWorker.ts:59-60`
- **Test:** `delivery.test.ts` › "records sent even if another job parked the row as needs_check mid-send"

### 5. The code that prevents duplicates had no test

- **Problem:** Only the send-time planner and encryption had tests. The restart test was a one-time manual run, and Day 2 was about to add the rate limiter to the same function.
- **Fix:** `backend/tests/integration/delivery.test.ts` runs against the Docker Postgres with fake SMTP:
  - two workers racing on one email send it once
  - SMTP error mapping (5xx, 4xx, no reply)
  - a late `sent` (fix 4)
  - repair of a failed job (fix 1)
  - double submit (fix 3)

### 6. Retry events didn't record their starting state

- **Problem:** `retry_requested` showed an empty "from" in the email timeline, because Retry accepts two starting states (`failed` and `needs_check`).
- **Fix:** The event now stores `fromStatus: email.status`.
- **Where:** `backend/src/routes/emails.ts:77`

## Found during live testing (fixed in `c18a2f4`)

### 7. Every new database connection stalled about 2 seconds on Windows

- **Problem:** On Windows, `localhost` is tried over IPv6 first. Each new Postgres connection waited about 2s before it fell back, and email claims timed out in bursts.
- **Fix:** The example URLs for Postgres, Redis and Elasticsearch, and the Redis and Elasticsearch defaults, use `127.0.0.1`. The browser-facing `APP_URL` stays `localhost`.
- **Where:** `backend/src/config/env.ts:18-19`, `backend/.env.example:2-5`

## Review 2: Day 2 code (fixed in `78cda1f`)

### 8. Dev login could go live on the public site

- **Problem:** `/auth/dev` logs anyone in as `dev@example.com` with no password. It was turned off only by `NODE_ENV=production`, which the production env list didn't set. If a local `.env` with `DEV_LOGIN=true` were copied to the server, anyone could log in, send email from that account's mailboxes and open Bull Board.
- **Fix:**
  - Dev login now also needs `APP_URL` to be `localhost` or `127.0.0.1`.
  - [docs/11](./11-deployment-aws.md) lists `NODE_ENV=production` for the server.
- **Where:** `backend/src/config/env.ts:52-54`
- **Checked:** with `DEV_LOGIN=true`, a public `APP_URL` gives `devLogin: false` and a localhost one gives `true`.

### 9. The OAuth "state" checks had no test

- **Problem:** "State" is a random value that proves a callback belongs to the login or Slack connection this user started. For Slack it is also tied to the logged-in user, so nobody can attach their channel to your account ([docs/06](./06-auth-slack.md)). These checks had only been tried by hand, so a later edit could break them without any test failing.
- **Fix:** `backend/tests/integration/oauth-state.test.ts` runs the real app on a free port, with Slack's token endpoint stubbed:
  - User A's Slack state used with user B's session → `?slack=error`. Nobody is connected and Slack is never called.
  - A's own state connects A, and using it a second time is rejected.
  - The Google callback rejects a wrong or missing state with `/login?error=state`.
- **Checked:** with the "same user" check removed from the Slack callback, the first test fails.

### 10. Zero was accepted for the limits and the window

- **Problem:** `MAX_EMAILS_PER_HOUR_PER_SENDER=0` (easy to read as "no limit") made every email "over the limit", so nothing was ever sent and nothing reported an error. `RATE_LIMIT_WINDOW_MS=0` divided by zero.
- **Fix:** `MAX_EMAILS_PER_HOUR`, `MAX_EMAILS_PER_HOUR_PER_SENDER`, `RATE_LIMIT_WINDOW_MS` and `WORKER_CONCURRENCY` must be above 0. Otherwise the process refuses to start and names the setting: `MAX_EMAILS_PER_HOUR_PER_SENDER: Too small: expected number to be >0`.
- **Where:** `backend/src/config/env.ts:13, 31-36`

### 11. A sender's next free slot could be forgotten during a long backlog

- **Problem:** For each sender, Redis remembers when its next send may start ([docs/04](./04-rate-limiting.md)). That record expired 2 windows after the last booking. Say the form delay is 0, the server minimum gap is 30s, and 1,000 leads come due at once. Slots are then booked up to 8 hours ahead, but the record expires after 2 hours. A second campaign from that sender 3 hours later would book "now" and send between the first campaign's slots, seconds apart.
- **Fix:** The record now lasts until its last booked slot has passed, plus one window (`PX slot + gap - now + win` in the Lua script). Normal setups never reached this case.
- **Where:** `backend/src/services/limiter.ts:24`
- **Test:** `limiter.test.ts` › "remembers the next slot until it has passed, even windows ahead". It fails with the old 2-window expiry.

### 12. Tests were no longer linted after the restructure

- **Problem:** Moving the tests from `src/` to `tests/` took them out of ESLint's reach, so unused imports and variables there passed without warning.
- **Fix:** ESLint covers `tests/**/*.ts`, and `npm run lint` runs `eslint src tests`. `npm run build` still lints only `src`, so a Docker build without the tests folder keeps working.
- **Where:** `backend/eslint.config.mjs:8`, `backend/package.json:13`

## Known and not fixed

- **SMTP 4xx has no cap on deferrals.** A 4xx reply moves the email to the next window without using a try, so a sender that always answers 4xx is deferred forever. It's marked with a `shortcut:` comment in `emailWorker.ts`.
- **"Needs check" emails wait for the user.** The Option C crash check (match the fixed Message-ID over IMAP) isn't built, so a `needs_check` email is only sent again when someone clicks Retry ([docs/10](./10-timeline.md)).
- **Bull Board shows every user's jobs**, not only your own. It is read-only and behind login (D21 in [docs/02](./02-design-decisions.md)).
