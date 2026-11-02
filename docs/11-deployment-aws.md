# 11 · Deployment (AWS + your own domain)

**Status:** 🟡 recommended. **When:** P2, **after** the local demo is recorded, so deployment trouble can't put the submission at risk. The assignment only requires a local run plus a demo video.

## Shape: one EC2, Docker Compose, Caddy

```
                     GoDaddy DNS (unchanged, plus ONE new A record)
                rottom.your-domain.com ──► Elastic IP
                                              │
            ┌──────────────── EC2 (Ubuntu, ap-south-1) ───────────────────────┐
            │ Caddy :443   automatic Let's Encrypt HTTPS                        │
            │   /api/*  /auth/*  /admin/*  ──► api:4000 (plain HTTP, private)   │
            │   everything else            ──► built React files (/srv/frontend)│
            │ api · worker ×2 · postgres · redis (AOF, noeviction) · elasticsearch
            │ data on EBS volumes                                               │
            └───────────────────────────────────────────────────────────────────┘
```

The same `docker compose` stack as local, plus Caddy. Nothing in the design changes between local and production.

## Steps

1. **EC2:** Ubuntu LTS in `ap-south-1` (Mumbai).
   - **t3.medium** (4 GB) at minimum, with Elasticsearch's memory set to 512 MB (`ES_JAVA_OPTS=-Xms512m -Xmx512m`). **t3.large** (8 GB) is comfortable.
   - Free-tier 1 GB machines are too small for Elasticsearch. Disk: 30 GB gp3.
2. **Elastic IP:** attach one so the address never changes.
3. **DNS (GoDaddy):** add **one new A record** for an **unused** subdomain, e.g. `rottom` → the Elastic IP.
   - Don't edit or move any existing record: the portfolio and the other project on this domain keep working.
   - Moving the DNS to Cloudflare was rejected for exactly this reason.
4. **Security group:**

   | Port | Open to | Why |
   |---|---|---|
   | 80, 443 | everyone | Caddy (80 is needed for the Let's Encrypt challenge and redirects to 443) |
   | 22 | **your IP only** | SSH |
   | 4000, 5432, 6379, 9200 | **nobody** | Express, Postgres, Redis, ES stay on the private Docker network. An exposed Redis or ES without a password gets hijacked within hours |

5. **Server setting for Elasticsearch:** `sudo sysctl -w vm.max_map_count=262144` (and persist it in `/etc/sysctl.d/`).
6. **Caddyfile:**
   ```
   rottom.your-domain.com {
     handle /api/*   { reverse_proxy api:4000 }
     handle /auth/*  { reverse_proxy api:4000 }
     handle /admin/* { reverse_proxy api:4000 }     # Bull Board; optionally limit to your IP
     handle {
       root * /srv/frontend
       try_files {path} /index.html
       file_server
     }
   }
   ```
   Caddy gets and renews the certificate by itself. That's inside Caddy, not cron in our code.
7. **Production env:**
   - `NODE_ENV=production` (also turns dev login off, along with the non-localhost `APP_URL`)
   - `APP_URL=https://rottom.your-domain.com`
   - `SLACK_REDIRECT_URI=https://rottom.your-domain.com/api/slack/callback`
   - real `ENCRYPTION_KEY`, Google and Slack secrets
   - `RATE_LIMIT_WINDOW_MS=3600000`
8. **OAuth redirect URIs (add alongside the local ones):**
   - Google: `https://rottom.your-domain.com/auth/google/callback`. Add the domain to the consent screen's authorized domains.
   - Slack: `https://rottom.your-domain.com/api/slack/callback`. Real HTTPS, so there's no localhost question in production.
9. **Deploy:**
   ```bash
   git pull
   (cd frontend && npm ci && npm run build)          # → /srv/frontend (mounted into Caddy)
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --scale worker=2
   docker compose exec api npx prisma migrate deploy
   ```
   Two workers show multiple consumers working safely in production.
10. **Smoke test:** login → schedule → send → Slack connect + alert → search → Bull Board at `/admin/queues`.
11. **Cost:** roughly **$35–70/month** (instance + disk + AWS's public-IPv4 charge). **Stop the instance after the review.** Backups: take a manual EBS snapshot before demos (no scheduled backup jobs).

## Why not managed AWS services (for now)

| Service | Problem for this project |
|---|---|
| **Amazon OpenSearch** | AWS's search service is a **fork of Elasticsearch**. The official `@elastic/elasticsearch` client refuses to talk to it (product check), and the assignment asks for Elasticsearch. Elastic Cloud on AWS would be the managed option |
| **ElastiCache (Redis)** | The default memory policy **evicts keys** (`volatile-lru`), so BullMQ jobs could vanish. It needs a parameter group with `noeviction`, and its persistence (snapshots/replicas) works differently from our AOF setup |
| RDS + ECS/Fargate + ALB + ACM | All solid, but VPC, subnets, task definitions and certificates take far longer than the deadline allows |

**Later production path:**
- frontend on S3 + CloudFront
- API and workers on ECS Fargate (scaled separately, using `WORKER_QUEUES`)
- RDS Postgres
- Redis with `noeviction` (MemoryDB for stronger durability)
- Elastic Cloud
- ALB + ACM

## Known limits of the single EC2

- **One point of failure:** if the instance dies, everything waits until it's back. Data survives on EBS, and the startup repair rebuilds the queue.
- **Vertical scaling only**, until the managed path above.
