# 07 · Audit trail and observability

## Audit trail

An append-only history of everything that happens to each email, plus every user action. Each event is written in the **same DB transaction** as the change it records, so every status on the dashboard can be traced to the events that caused it.

### No change without a record

`updateEmail(id, data, event)` is the single place email rows change. In **one transaction** it:
1. updates the row and bumps `version`
2. inserts the `AuditEvent`

After the commit it queues the `search-sync` job.

The event and the change commit or roll back together, so a status change without an event can't happen. Useful side effect: after a crash mid-send, the history shows `claimed` with no `sent` after it, which is exactly the "Needs check" case, visible in the log itself.

### Model

See [01 · Architecture](./01-architecture.md#data-model-prisma-planned). Fields: `userId`, `campaignId?`, `emailId?`, `type`, `fromStatus`, `toStatus`, `actor` (`user:<id>` | `worker:<host>:<pid>` | `system:startup-repair`), `attempt`, `data` (JSON), `createdAt`. Indexed by email, campaign and user (each with time).

### Event catalogue

| Event | Key `data` |
|---|---|
| `campaign_created` | lead count, delay, hourly limit, sender, start time |
| `scheduled` (one per email, bulk insert) | `scheduledAt` |
| `claimed` | worker id, attempt |
| `sent` | **SMTP reply** (`250 Accepted…`), `messageId`, preview URL: proof the server accepted it (outlives Ethereal's few-hour retention) |
| `send_failed` / `failed` | error, attempt, whether it will retry |
| `smtp_deferred` | SMTP 4xx text, new time |
| `deferred_rate_limit` | mode, count, limit, window, new time |
| `queue_paused` (global mode) | paused until |
| `skipped_duplicate` | a second claim lost the race: **visible proof that idempotency works** |
| `delivery_checked` | Option C mailbox check: `found` / `not_found` and why, after a crash or on Retry send |
| `needs_check` / `retry_requested` | reason / which user, and the mailbox check result on Retry |
| `slack_notified` / `slack_skipped` / `slack_failed` | HTTP status, channel, or "not connected" |
| `slack_connected` / `slack_disconnected` / `slack_broken` | team, channel, error |
| `sender_created` / `sender_broken` | sender email, reason |
| `login` / `logout` | user |
| `startup_repair` | how many emails were re-queued and re-indexed |

### Making it trustworthy

- **Append-only in the database:** a Postgres trigger (raw SQL in a Prisma migration) rejects any `UPDATE` or `DELETE` on `audit_event`, so even a bug in our own code can't rewrite history.
  ```sql
  CREATE FUNCTION audit_event_readonly() RETURNS trigger AS $$
  BEGIN RAISE EXCEPTION 'audit_event is append-only'; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER audit_event_no_change BEFORE UPDATE OR DELETE ON "AuditEvent"
    FOR EACH ROW EXECUTE FUNCTION audit_event_readonly();
  ```
- **Bull Board is read-only,** so nobody can retry or delete jobs outside the audit. Replays go through `POST /api/emails/:id/retry`.

### Where you see it

- **History timeline per email:** click a row to open a drawer, e.g. `scheduled → deferred (5/5, moved to 15:00) → claimed → sent (250 Accepted)`, served by `GET /api/emails/:id/events`.
- **Comparing the two limiters:** the same table is the measurement data. One SQL query per mode gives deferrals per sender, the time to send all 1000, and Slack alerts per window, using real load-test numbers.
- **Slack proof in the demo:** "Slack notified 14:00:02 (HTTP 200)" appears next to the deferral.

### Considered and skipped: hash chain

Each event would store `hash = HMAC(key, prevHash + event)`, chained per email. Editing or deleting an event in the middle breaks the chain, and a verify endpoint finds it. Cutting off the newest events would still go unnoticed without an outside copy of the last hash.

**Skipped:** email-sending services (SendGrid, Mailgun, SES, Postmark) keep per-message event logs for debugging and delivery tracking, not hash-chained ones. Tamper-evident logs are used where records must be **proven unaltered to an outside party**: regulated email archiving (write-once storage), cloud audit logs (e.g. AWS CloudTrail's log integrity check chains digest files), ledgers, and Certificate Transparency (Merkle trees). A scheduler doesn't need that.

### Also skipped

- **Automatic cleanup of old events.** It would need a scheduled job, which conflicts with no-cron. `npm run audit:prune` (manual) if ever needed.
- **Operational logs (pino):** separate from the audit record. Add later for debugging.

## Bull Board

`@bull-board/express`: a ready-made web page for looking inside the BullMQ queues. It meets the assignment's "live BullMQ dashboard" requirement.

```ts
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: [emailQueue, searchSyncQueue].map(q => new BullMQAdapter(q, { readOnlyMode: true })),
  serverAdapter,
});
app.use('/admin/queues', requireAuth, requireAdmin, serverAdapter.getRouter()); // admins only: it shows every user's jobs
```

Only users whose Google email is in `ADMIN_EMAILS` can open it; everyone else gets 403, because it shows every user's jobs. It's served on the same domain (`https://rottom.your-domain.com/admin/queues`, through Caddy). In production it can additionally be limited to your IP in the Caddyfile ([11](./11-deployment-aws.md)).

| State | Meaning here |
|---|---|
| Delayed | waiting for their scheduled time, plus emails pushed to the next window by the per-sender limiter |
| Waiting | due, waiting for a free worker. In global mode this grows while the queue is paused |
| Active | being sent right now |
| Completed | sent (kept 24h / last 1000) |
| Failed | gave up after 8 tries, a permanent SMTP error, or parked as needs check (the DLQ) |

| | Who | What | Source |
|---|---|---|---|
| React dashboard | users | emails (Scheduled / Sent) | Postgres |
| Audit timeline | users / support | history of one email | Postgres `AuditEvent` |
| Bull Board | admins (`ADMIN_EMAILS`) | queue jobs and their state, all users | Redis |
| Logs | developers | what each process did and why something failed | stdout of the API and worker |

**In the demo:**
- **Restart:** the Delayed count is unchanged.
- **Rate limit:** jobs go back to Delayed with next-window times (per-sender), or Waiting piles up (global).
- **Load:** Delayed drains at the configured rate.
- **Search:** `search-sync` jobs appear on each change.

## Logs

`backend/src/lib/log.ts`, no logging library. One line per event with a time, a level, a message and context fields (`emailId`, `userId`, `status`, `ms`...). Readable lines in development, one JSON object per line when `NODE_ENV=production`, so log tools can filter by field. `docker compose logs -f api worker` shows them in Docker.

```
18:23:05.312 ERROR google login failed step="exchanging the code with Google" error="ETIMEDOUT request to https://oauth2.googleapis.com/token failed, reason: "
14:08:57.204 INFO  email sent emailId=… campaignId=… sender=…@ethereal.email attempt=1 ms=812 reply="250 Accepted [STATUS=new MSGID=…]"
14:09:01.010 INFO  rate limit: email moved to the next window emailId=… senderId=… limit=5 newTime=2026-11-03T08:40:00.000Z
```

- **API:** one line per write, error or slow request (method, path, status, ms, userId). Fast, successful reads are skipped, because the dashboard polls every 5 seconds. Login (and which step failed), Slack connect, search errors, startup repair, unexpected errors with their stack.
- **Worker:** every email sent (with the SMTP reply and how long it took), deferred, rejected, parked as "needs check" or recovered after a crash; rate-limit moves and pauses; Slack alerts; failed mailbox checks; jobs that fail and whether they'll retry.
- **Errors** show the code (`ETIMEDOUT`, `EAI_AGAIN`, `ECONNREFUSED`...), the HTTP or SMTP status, the server's reply and the chain of causes. A connection that failed on every address lists each attempt. This fixed a Google login log that ended in an empty "reason:" and said nothing.
- **Never logged:** query strings (they can hold OAuth codes), the request settings HTTP libraries keep on errors (the Google one holds the client secret; `tests/unit/log.test.ts` checks it), passwords, tokens, webhook URLs and lead addresses (ids only).
- **The audit trail stays the record** of what happened to each email; logs are for operating and debugging the processes.
