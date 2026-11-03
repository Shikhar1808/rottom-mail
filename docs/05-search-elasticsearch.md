# 05 · Search with Elasticsearch

Elasticsearch is a **search copy**. Every change goes to Postgres first, and a BullMQ queue copies it into ES. Sending never depends on ES.

## Sync flow (outbox-style)

```
API / email worker ──1. updateEmail(): change row + version+1 + audit event   (ONE transaction)
                   └─2. after commit: add job to `search-sync`  { emailId }

search-sync worker ──3. read the LATEST row (joined with campaign + sender)
                   ──4. ES index: _id = email.id, version = row.version, version_type = external
                   ──5. UPDATE email SET indexedVersion = row.version WHERE indexedVersion < row.version
```

- `updateEmail(id, data, audit)` is the **only** way email rows change. Nobody calls `prisma.email.update` directly, so no write point is ever missed.
- This is the **transactional outbox** idea without a separate outbox table. `version > indexedVersion` *is* the pending flag, and it's committed in the same transaction as the change.

## When ES gets updated

| Event | Who | What changes in ES |
|---|---|---|
| Campaign scheduled (e.g. 1000 leads) | API | **One bulk job per campaign**, ES `_bulk` in chunks of 500 |
| Claim | email worker | `status: sending` |
| Sent | email worker | `status: sent`, `sentAt`, `messageId` |
| Failed | email worker | `status: failed`, `error` |
| Rate limit / SMTP 4xx (per-sender mode) | email worker | new `scheduledAt` |
| Rate limit (global mode) | — | nothing (rows don't change; the queue is just paused) |
| Crash check found it sent | email worker | `status: sent` |
| Crash check couldn't answer | email worker | `status: needs_check` |
| Retry send | API | `status: scheduled` |

## Failure handling

| Problem | Handling |
|---|---|
| ES down | Sync jobs retry with backoff. Sending is **never blocked**. After the retries run out, the job lands in the `failed` set (visible in Bull Board) |
| Crash between commit and queueing | Startup repair re-queues rows where `indexedVersion < version` |
| Updates out of order ("sent" before "sending") | `version_type: external`: ES rejects anything older than the stored version |
| The same sync job runs twice | ES returns 409 "same or newer version", treated as success |
| Full reindex | `UPDATE email SET "indexedVersion" = 0`, then let the repair rebuild. No separate script |

## Index mapping (created by the API on boot if missing)

| Field | Type | Use |
|---|---|---|
| `userId`, `campaignId`, `status`, `senderEmail` | `keyword` | exact filters |
| `toEmail` | `text` (pattern analyzer splitting on non-letters/digits) + `keyword` subfield | "john" or "acme" finds `john@acme.com` |
| `subject`, `body` | `text` | full-text search |
| `scheduledAt`, `sentAt` | `date` | sort / range |

## Search: "ES finds, Postgres shows"

```ts
const res = await es.search({ index: 'emails', size: 50, _source: false, query: { bool: {
  filter: [{ term: { userId } }, ...(status ? [{ term: { status } }] : [])],   // userId from the session only
  must: { bool: { minimum_should_match: 1, should: [
    { multi_match: { query: q, fields: ['subject^2', 'body'], fuzziness: 'AUTO', operator: 'and' } }, // typos OK
    { match: { toEmail: { query: q, operator: 'and', boost: 2 } } },                                  // exact words
    { multi_match: { query: q, type: 'bool_prefix', fields: ['toEmail', 'subject'], operator: 'and' } }, // while typing
  ] } },
}}, sort: ['_score', { scheduledAt: 'desc' }] });

const ids  = res.hits.hits.map(h => h._id);
const rows = await prisma.email.findMany({ where: { id: { in: ids }, userId, ...(status && { status }) } }); // second check
const byId = new Map(rows.map(r => [r.id, r]));
return ids.map(id => byId.get(id)).filter(Boolean);                                // keep ES ranking
```

- **Tuned on real data:** `operator: 'and'` so `lead07@example.com` doesn't return every `@example.com` email, and no typo tolerance on addresses, where one digit is the whole difference (`lead07` vs `lead01`). Typos are still forgiven in subjects and bodies (`globl demo` works).
- **ES down:** the search box gets a 503 ("Search is unavailable right now. The tabs still work.") within about 4s. The client retries once; sync jobs retry through BullMQ.
- **Statuses in search results are never stale.** The only lag left is that a brand-new email becomes *findable* about 1s later (ES refreshes every 1s by default).
- **Second security check:** `userId` is enforced in Postgres too.
- **Cost:** one extra indexed query per search.

## Read paths

| Dashboard part | Reads from | Why |
|---|---|---|
| Scheduled / Sent tabs | **Postgres** | Exact and instant. They don't break if ES is down |
| Search box | **ES** (IDs) → **Postgres** (rows) | The assignment requires ES. Typo tolerance, ranking, fast body search |

## Research: how others do it

| Project | Lists | Search | Sync | Takeaway |
|---|---|---|---|---|
| **GitLab** (large production) | Postgres. Even searches typed into the issue list: **2,225,967 requests with `search` in 7 days, zero ES calls** | ES for the global search page | Model callbacks → Redis set of pending changes → bulk indexer worker. ES hits are **loaded back from Postgres** (`preload_search_data`) and checked for permissions | Matches our design. GitLab drains its set with a *cron* worker; we use per-change BullMQ jobs instead (no cron) |
| **Mailgun** (billions of events/month) | ES (Logs tab, Events API) | ES | Redis list → Logstash → ES, ~1,500 events/s, **30-day retention**, daily indices (5 shards, 1 replica) | Works because events are **append-only** and short-lived. Our rows change status, so Postgres fits better |
| **listmonk** (small, open source) | Postgres | Postgres full-text search (switched in v2.3.0), **no ES** | — | Small projects often skip ES. Here the assignment requires it |
| **General guidance** | Relational DB = source of truth | ES = copy | Dual writes are fine for prototypes. The outbox avoids the gap between the two writes | Our version / `indexedVersion` approach is the outbox |
| **Elastic docs** | — | Near real-time: refresh every **1s** by default (only on indices searched in the last 30s) | For read-your-own-writes use `refresh=wait_for`, not forced refreshes | Our sync runs in the background, so no `wait_for` needed |

Sources: [references.md](./references.md#search--elasticsearch).
