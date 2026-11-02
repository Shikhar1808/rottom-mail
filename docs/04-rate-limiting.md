# 04 · Rate limiting, delay and concurrency

The assignment requires a configurable worker concurrency, a minimum delay between sends, and an hourly limit that is safe across workers and never drops jobs. We build **two implementations** and compare them.

```
RATE_LIMIT_MODE=per_sender | global
MIN_DELAY_BETWEEN_SENDS_MS=2000        # chosen delay: at least 2s between sends
MAX_EMAILS_PER_HOUR=200                # global mode: whole system
MAX_EMAILS_PER_HOUR_PER_SENDER=200     # per-sender mode (keep ≤ 200: Ethereal's own limit)
RATE_LIMIT_WINDOW_MS=3600000           # 1 hour. Set 60000 for the demo
WORKER_CONCURRENCY=5
```

**Chosen values (for the README):** at least **2 seconds between sends** (system-wide in global mode, per sender in per-sender mode). **200 emails per hour** (system-wide or per sender).

## Shared by both modes

- **Plan layer (compose form):** the form's delay and hourly limit set each email's planned `scheduledAt` (see [O1](./02-design-decisions.md#o1--what-do-the-compose-forms-delay-and-hourly-limit-control-)).
- **Guard layer (limiter):** enforces the env caps at send time. This is the only part that differs between the modes. Both live behind one function used by the worker, `gate(job, token, email)`. It either returns (send now) or throws `DelayedError` / `RateLimitError` (not now).
- Both use the same claim-then-send step, the same Slack hook, and the same SMTP reply handling.
- All state is in **Redis** (atomic `INCR` and Lua), never in memory, so any number of workers and instances share it safely.

## Implementation 1: global limiter

One budget for the whole system, whichever sender.

```ts
const worker = new Worker('emails', processEmail, {
  connection, concurrency: env.WORKER_CONCURRENCY,
  limiter: { max: 1, duration: env.MIN_DELAY_BETWEEN_SENDS_MS },   // delay: 1 start per 2s, all workers
});

async function gate(job, token, email) {
  const window = Math.floor(Date.now() / env.RATE_LIMIT_WINDOW_MS);
  const count = await incrWithExpiry(`rl:global:count:${window}`, env.RATE_LIMIT_WINDOW_MS * 2);
  if (count === env.MAX_EMAILS_PER_HOUR) await notifyLimitReached(email, 'global');   // exactly once
  if (count > env.MAX_EMAILS_PER_HOUR) {
    await worker.rateLimit((window + 1) * env.RATE_LIMIT_WINDOW_MS - Date.now());     // pause whole queue
    throw Worker.RateLimitError();                     // job goes back to waiting, not counted as failed
  }
}
```

- **Delay:** BullMQ's built-in limiter. It's stored in Redis, so it holds across all workers.
- **Hourly limit:** one Redis counter per window. When it's full, the **whole queue pauses** until the next window and jobs keep their place in line (to confirm with a test).
- About 10 lines, almost all BullMQ built-ins.

## Implementation 2: per-sender limiter

Each sender mailbox has its own budget. **There are no per-sender workers.** Every worker is generic, and only the Redis records are per sender:

```
     ONE `emails` queue (all senders mixed)  →  any worker takes any job
     Redis, one record per sender (shared by all workers):
       Alice → next free slot 15:00:04 · sent this window 37 / 200
       Bob   → next free slot 15:00:02 · sent this window 12 / 200
```

### `reserveSlot` (one atomic Lua script)

```lua
-- KEYS[1] next-slot key      rl:{sender:<id>}:next
-- KEYS[2] counter prefix     rl:{sender:<id>}:count:
-- KEYS[3] overflow prefix    rl:{sender:<id>}:overflow:
-- ARGV    now, minDelayMs, limit, windowMs
local now, gap, limit, win = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local slot   = math.max(now, tonumber(redis.call('GET', KEYS[1]) or '0'))
local window = math.floor(slot / win)
local count  = redis.call('INCR', KEYS[2] .. window)
if count == 1 then redis.call('PEXPIRE', KEYS[2] .. window, win * 2) end
if count > limit then                                   -- window full: next window, in arrival order
  local seq = redis.call('INCR', KEYS[3] .. window)
  redis.call('PEXPIRE', KEYS[3] .. window, win * 2)
  return {0, (window + 1) * win + (seq - 1) * gap, 0}   -- {slot, deferTo, hitLimit}
end
redis.call('SET', KEYS[1], slot + gap, 'PX', win * 2)  -- next email from this sender: 2s later
return {slot, 0, count == limit and 1 or 0}             -- hitLimit exactly once per window
```

### Worker: book the slot, step aside (never sleep)

```ts
async function gate(job, token, email) {
  let slot = job.data.slot;                                   // booked on an earlier pass?
  if (!slot) {
    const [booked, deferTo, hit] = await reserveSlot(email.senderId, Date.now());
    if (hit) await notifyLimitReached(email, 'per_sender');   // this send reached the limit
    if (deferTo) return defer(job, token, email, deferTo, 'deferred_rate_limit');
    slot = booked;
  }
  if (slot > Date.now() + 50) {                               // not this sender's turn yet
    await job.updateData({ ...job.data, slot });
    await job.moveToDelayed(slot, token);                     // worker slot freed right away
    throw new DelayedError();
  }
}
// defer(): updateEmail(scheduledAt = deferTo, audit) → clear job.data.slot → moveToDelayed → DelayedError
```

Why step aside: if workers **slept** until the slot, 1000 emails for Alice would fill all 5 worker slots with sleeping jobs and Bob's 10 emails would wait behind them. Moving the job to its booked time frees the worker immediately, so worker slots are only used for real SMTP sending. The cost is one extra Redis round trip for jobs that had to wait.

## Side by side

| | Global | Per-sender |
|---|---|---|
| Code size | ~10 lines, mostly built-ins | ~40 lines, custom Lua |
| Throughput (3 senders, 2s delay) | 1 email / 2s total | 3 emails / 2s |
| Worker concurrency | Mostly idle (the limiter caps job starts) | Does real work (senders in parallel) |
| One sender bursts 1000 emails | **Blocks everyone** (one line) | Only that sender waits |
| When the limit is hit | Whole queue pauses | Only that sender's jobs move |
| Order | Strict order across the queue | Strict order per sender (overflow sequence) |
| Dashboard times | Stay at the old time, so show a "paused until 15:00" banner | Each email's `scheduledAt` updated to its real new time |
| Redis/DB work under a burst | Low (jobs just wait) | Each deferred job touched once per move |
| Slack alert | "System limit reached" | "Sender alice@ reached its limit" (matches the assignment's wording) |
| Ethereal's 200/hr per mailbox | One sender can go over it, so Ethereal 4xx → deferred | Never reached if the cap is ≤ 200 |
| Real-world match | Providers limit per mailbox | ✅ Gmail/Outlook-style per-mailbox limits |
| Safe across many workers | ✅ BullMQ Redis limiter | ✅ atomic Lua |
| Weak spot | Unfair, and senders sit idle | No system-wide cap: many senders together could exceed a provider/IP limit |

**Not chosen:** one queue per sender (`emails-alice`, `emails-bob`, each with BullMQ's limiter). It uses built-ins and isolates senders, but it needs queues and workers created at runtime for every new sender (100 senders means 100 queues), and the hourly limit would still be custom. BullMQ's per-group limits exist only in the paid **BullMQ Pro**.

## Under load: 1000+ emails at the same moment

Example: 1000 emails from one sender, limit 200/window, 2s delay.
- **Per-sender:** the 1000 jobs come due. Each one books a slot quickly (one Lua call) and steps aside. 200 get slots 2s apart (~400s). The other 800 get next-window times in arrival order. The 200th send fires **one** Slack alert. In the next window the 800 wake up spaced out, 200 more go, and the rest roll forward again the same way. **Nothing is dropped.**
- **Global:** the limiter lets one job start every 2s. After 200 the counter passes the cap, the queue pauses until the next window, one Slack alert fires, and the remaining jobs keep their order in the waiting list.
- Throughput formulas and the 3-sender example are in [09](./09-scaling-impacts.md#throughput-math).

## Slack hook

- `hitLimit` comes from the atomic counter (`count == limit`), so the alert fires **exactly once per window** without an extra dedupe key. It's queued on `notifications` with `jobId = slack-<user>-<sender|global>-<window>`.
- The message says how many emails are still due this window (one count query) and when sending resumes ([06](./06-auth-slack.md#slack-messages)).

## Why not just rely on Ethereal's limit?

Ethereal limits public accounts to **200 messages/hour** (then rejects until the next hour) and keeps caught messages for a few hours. Neither replaces our limiter:

| Assignment requires | Ethereal's 200/hr limit | Our Redis limiter |
|---|---|---|
| Limit configurable via env | ❌ fixed at 200 | ✅ |
| Minimum delay between sends | ❌ a burst of 200 is fine | ✅ 2s gap |
| Hourly limit from the compose form | ❌ knows nothing about campaigns | ✅ |
| When reached: delay to the next hour, keep order | ❌ just **rejects** | ✅ next window, in order |
| Slack **the moment** it's reached | ❌ we'd only learn after a bounce | ✅ fires at `count == limit`, exactly once |
| Redis/DB counters, safe across workers | ❌ not ours, invisible to us | ✅ atomic Lua / `INCR` |
| Works in `SMTP_MODE=fake` | ❌ no Ethereal there | ✅ |
| Works after switching providers | ❌ every provider differs | ✅ same code, new env values |

- **Real world:** senders throttle *before* the provider's limit. Gmail, Outlook and SendGrid treat repeated limit hits as abuse and can suspend the mailbox or hurt its deliverability.
- **How they fit:** our limiter runs first (cap ≤ 200 per sender), so Ethereal's limit is normally never reached. If it is (e.g. one sender in global mode), Ethereal's SMTP 4xx moves the email to the next window (below).
- **Ethereal's storage** is a preview inbox, not a job store. It doesn't know what's still to be sent or when. That lives in Postgres + Redis and must survive restarts for days.

## SMTP reply handling

| Reply | Meaning | Action |
|---|---|---|
| `250` | accepted | `sent` |
| `4xx` (e.g. Ethereal's 200/hr rejection) | temporary | Move to the next window, audit `smtp_deferred`, **don't** use up attempts |
| `5xx` | permanent | `failed` |
| `535` auth failure | sender's Ethereal account broken | Sender becomes `broken`, email `failed` with reason, user is told |
| network / timeout | unknown | Back to `scheduled`, BullMQ retry with backoff |

## Demo and test settings

- **Demo:** `RATE_LIMIT_WINDOW_MS=60000`, `MAX_EMAILS_PER_HOUR_PER_SENDER=5`, 15 leads. You'll see 5 sends, a Slack alert, and 10 moved to the next minute in order. Then switch `RATE_LIMIT_MODE=global` and repeat.
- **Tests (vitest, real Redis from docker):**
  - spacing is ≥ `gap`
  - the limit hit returns `hitLimit` exactly once
  - overflow keeps order
  - two parallel callers never get the same slot
  - global counter: one alert
