# Docs

| Doc | What's inside |
|---|---|
| [01 · Architecture](./01-architecture.md) | Components, processes, queues, data model, API, end-to-end flow, status lifecycle, folder layout |
| [02 · Design decisions](./02-design-decisions.md) | Every decision (D1–D22) with options, why, and trade-offs. Open questions (O1–O4) |
| [03 · Scheduling & persistence](./03-scheduling-persistence.md) | Delayed jobs, restart survival, crash scenarios, idempotency, at-most-once + crash check, NACK/DLQ, no-cron + ESLint |
| [04 · Rate limiting](./04-rate-limiting.md) | Global vs per-sender implementations, Lua script, step-aside fix, comparison, behaviour under load, SMTP replies |
| [05 · Search](./05-search-elasticsearch.md) | ES sync queue (outbox-style), versions, "ES finds, Postgres shows", research on GitLab / Mailgun / listmonk |
| [06 · Auth & Slack](./06-auth-slack.md) | One-origin hosting, why sessions, cookie contents, Google OAuth (state + PKCE), Redis sessions, Slack connect, local dev with mkcert, messages, security checklist |
| [07 · Audit & observability](./07-audit-observability.md) | Append-only audit trail, event catalogue, trigger, Bull Board, hash chain (skipped) |
| [08 · Senders & Ethereal](./08-senders-ethereal.md) | Per-user Ethereal mailboxes (option B), SMTP pooling, Ethereal limits and what they change |
| [09 · Scaling & impacts](./09-scaling-impacts.md) | Multiple consumers and senders, throughput math, data store limits, load testing, impact of each decision |
| [10 · Timeline](./10-timeline.md) | Hour blocks with tick boxes, priorities, cut line, demo script, submission checklist |
| [11 · Deployment (AWS)](./11-deployment-aws.md) | Single EC2 + Docker Compose + Caddy, one new GoDaddy record, what's public vs private, why not managed services yet |
| [References](./references.md) | Every source used, the data taken from it, and what is still unverified |
