# 09 · Scaling and impacts

**Main point:** the rate limits cap throughput, not the servers. Everything with state lives in Postgres or Redis, so you scale by **running more copies** of the API and the workers.

## Multiple consumers (workers)

BullMQ hands each job to **exactly one** worker (an atomic move in Redis). 4 workers × `concurrency=5` means up to 20 jobs in progress at once.

| Risk with many workers | Protection |
|---|---|
| Same email queued twice | `jobId = email.id` |
| Two workers send the same email | Atomic DB claim `scheduled → sending` |
| Workers race on rate limits | Per-sender: atomic Lua. Global: BullMQ's limiter, stored in Redis |
| A worker dies mid-job | Stalled check + Option C crash check |
| ES updates arrive out of order | `version_type: external` |
| Every API instance runs the startup repair | Redis lock `repair_lock`: only one does it, in batches |

**Operations:**
- **Scale each queue separately:** `WORKER_QUEUES=emails` / `search-sync` / `notifications`, each with its own concurrency env var. E.g. 4 × emails, 1 × search-sync, 1 × notifications.
- **Graceful shutdown:** on `SIGTERM`, `await worker.close()`. The worker stops taking jobs and finishes the active ones, so deploys and scale-downs don't create stalled jobs.
- **API servers hold no state** (sessions in Redis, data in Postgres). Put any number behind a load balancer.

## Multiple senders

- **No per-sender workers.** One queue, generic workers, and one small Redis record per sender ([04](./04-rate-limiting.md#implementation-2-per-sender-limiter)).
- **Busy-sender fix:** workers book the slot and step aside instead of sleeping, so 1000 emails for Alice can't block Bob's 10.
  ```
  worker takes Alice #7 → Lua books 15:00:12 → in the future → moveToDelayed(slot), slot saved in job data → worker free
  worker takes Bob #1   → slot = now → sends immediately
  15:00:12 → Alice #7 wakes, already has a slot → sends (no second booking)
  ```
- **Pooled SMTP** per sender (`pool: true, maxConnections: 2`), cached per worker.
- **Optional (open, [O2/O3](./02-design-decisions.md#open-questions)):** sender rotation (round-robin a campaign over the user's senders, so throughput × number of senders) and a `Sender.hourlyLimit` column (`min(campaign, sender, env cap)`).

## Throughput math

- One SMTP send takes about 300ms, so one worker with `concurrency=5` can do roughly 15 per second.
- Policy example: 10 senders × 200/hr = **2000/hr ≈ 0.6 per second**.
- One worker is therefore already about 25× more than needed. **Extra workers are for staying up if one dies, not for speed.**

| Mode | Max throughput per hour |
|---|---|
| Global | `min(3600 / delay_s, MAX_EMAILS_PER_HOUR)` |
| Per-sender | `senders × min(3600 / delay_s, MAX_EMAILS_PER_HOUR_PER_SENDER)` |

| Scenario (2s delay, 200/hr cap) | Global | Per-sender |
|---|---|---|
| 1 sender, 1000 emails | 200/hr, about 5 windows to finish | 200/hr, about 5 windows |
| 3 senders, 1000 emails each | 200/hr total, **15 windows** | 600/hr, **5 windows** |
| Demo: 3 senders, 30 emails, cap 5, 60s window | 5 per minute total | 15 per minute (5 each) |

## Data stores

| Store | What matters at scale | Plan |
|---|---|---|
| **Postgres** | Big inserts, list queries, connection count | `createMany` / `addBulk` in chunks of 500. Indexes `(userId, status, scheduledAt)` and `(senderId, status, scheduledAt)`. **Cursor pagination** on `(scheduledAt, id)` instead of `OFFSET`. Connection budget: instances × Prisma pool < 100 (e.g. 10 × 5), PgBouncer beyond that. Partial index `WHERE "indexedVersion" < "version"` for the repair query |
| **Postgres: audit** | ~3+ events per email (1M emails ≈ 3M+ rows) | Indexed by email / campaign / user. Partitioning later. No automatic cleanup (no cron) |
| **Redis** | Memory, availability | Job data is only `{ emailId }`, so a million delayed jobs stay small. `removeOnComplete` / `removeOnFail` by age keep it bounded. `noeviction` + AOF. Managed Redis with a replica for high availability. **Redis Cluster:** every key the Lua script uses must share a hash tag (`rl:{sender:<id>}:…`, already the naming) and BullMQ needs a hash-tagged prefix. Future work |
| **Elasticsearch** | Index load | Bulk writes per campaign. 1 node / 1 shard is plenty at this size. For huge volumes, split indices by time (Mailgun used daily indices, 5 shards, 1 replica, 30-day retention) |
| **Ethereal** | 200/hr per mailbox, a few hours of retention, 100MB | Cap ≤ 200 per sender, 4xx means try later, `SMTP_MODE=fake` for load tests |

## Load testing

- `SMTP_MODE=fake` swaps in nodemailer's `jsonTransport`. Messages are built as JSON and go nowhere, so 1000 or 10,000 emails can run through the full queue, limiter and audit path in seconds. The assignment says you don't need to actually send thousands via Ethereal, and this tests the logic properly instead.
- A load script POSTs 1000 leads and measures:
  - insert + enqueue time
  - the steady send rate vs the formula above
  - deferrals per sender (audit query)
  - one Slack alert per window
  - Bull Board counts draining
- Run it once per `RATE_LIMIT_MODE` and put both sets of numbers in the README comparison.

## Impact of each decision under load

| Decision | Impact with 1000+ emails at once |
|---|---|
| Delayed jobs + `jobId` | All 1000 sit cheaply in Redis. Re-adds and repairs are free (ignored) |
| Postgres as truth + transaction | One large transaction per campaign (chunked). Stuck halfway is impossible |
| Per-sender Lua + step aside | Each job: 1–2 Redis calls + 1 extra delayed move if it must wait. Workers never sit idle |
| Global limiter | Fewest operations (jobs just wait), but one sender's burst blocks everyone |
| Overflow to the next window | Nothing dropped, order kept. Jobs may roll over several windows (one Redis call each time) |
| Option C crash check | Costs nothing normally. An IMAP lookup only after a crash |
| ES sync queue | 1 bulk job per campaign + 2–3 small jobs per email (claim, sent). ES lag grows if the sync worker falls behind, but tabs stay exact because they read Postgres |
| Audit in the same transaction | +1 insert per change (~3 per email). Simple and cheap at this scale |
| Slack once per window | Exactly one alert per sender per window, no matter how many jobs are deferred |
| Fake SMTP mode | Load tests don't hit Ethereal's 200/hr limit |

## Known limits and future work

- No system-wide cap in per-sender mode (could add a global ceiling on top).
- Redis Cluster support (hash tags + BullMQ prefix).
- Sender rotation and per-sender limits (O2/O3).
- Fairness between campaigns on the same sender is first-come-first-served (BullMQ priorities could change that).
- Audit partitioning and manual pruning.
- Real mailboxes (Gmail/Outlook OAuth, own SMTP) instead of Ethereal.
