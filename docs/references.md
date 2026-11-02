# References and research data

Sources fetched during the design discussion (2026-11-02), what each one supported, and the key data taken from it. The last two sections cover what was **not** fetched and what is **still unverified**.

## Search & Elasticsearch

| Source | Used for | Key data |
|---|---|---|
| [GitLab: Advanced search development docs](https://docs.gitlab.com/development/advanced_search/) | "ES finds, Postgres shows". Sync via a queue | Model callbacks (`after_create/update/destroy`) feed a **Redis ZSET of pending changes**. A worker bulk-indexes with the Bulk API (`Elastic::ProcessBookkeepingService.track!`). Hits are turned back into DB records (`preload_search_data`) and unauthorized ones are removed |
| [GitLab epic 23629](https://gitlab.com/groups/gitlab-org/-/epics/23629) | Lists stay on Postgres even at GitLab scale | `issue_search_data` ≈ **227 GiB**. Over 7 days, **2,225,967** issue-list requests carried `search`, and **zero** made an ES call |
| [GitLab handbook: Global Search group](https://handbook.gitlab.com/handbook/engineering/ai/search/) | Basic vs advanced search | Basic search = Postgres text search + Gitaly. Advanced = Elasticsearch |
| [GitLab issue 41450 (history)](https://gitlab.com/gitlab-org/gitlab-ce/issues/41450) | Background | An early debate: ES vs Postgres extensions for big data. They went with ES |
| [Elastic blog: Mailgun, billions of searchable events](https://www.elastic.co/blog/using-elasticsearch-and-logstash-to-serve-billions-of-searchable-events-for-customers) | When reading from ES fits (append-only logs) | "We track and store every event that happens to every email". Redis list → Logstash → ES. **~1,500 events/s**. **30-day retention**. Daily indices, **5 shards / 1 replica**. The Logs tab and Events API read from ES (2013 post) |
| [Mailgun blog: Mailgun + Elasticsearch](https://www.mailgun.com/de/blog/product/mailgun-elasticsearch/) | Same | The Events API is built on ES |
| [listmonk issue #1058](https://github.com/knadh/listmonk/issues/1058) | Small projects skip ES | Switched to **Postgres full-text search in v2.3.0**. "all" is a Postgres English stop word |
| [Elastic forum: ES on top of Postgres?](https://discuss.elastic.co/t/should-we-adopt-elasticsearch-on-top-of-postgres-to-handle-our-search-filtering/283324.md) | The dual-write concern | Keeping ES in sync with Postgres via dual writes is the stated pain point |
| [Gitconnected: Elastic Search 101](https://levelup.gitconnected.com/elastic-search-101-de7ef8aa2469) | ES is not the primary store | "Not suitable for your transactional database needs… should not be your primary data store" |
| [Elastic docs: data store](https://www.elastic.co/docs/manage-data/data-store) | Elastic's own positioning | Described as a search/analytics engine and document store. Data streams for append-only data |
| [Elastic docs: Near real-time search](https://www.elastic.co/guide/en/elasticsearch/reference/master/near-real-time.html) · [Refresh API](https://elastic.co/guide/en/elasticsearch/reference/8.15/indices-refresh.html) | Search lag | Refresh **every 1s** by default, only on indices searched in the **last 30s**. Use `refresh=wait_for` for read-your-own-writes. Forced refreshes are costly |
| [OneUptime: replicate data to Elasticsearch](https://oneuptime.com/blog/post/2025-12-19-replicate-data-to-elasticsearch/view) | DB = truth, ES = replica | Options: Logstash, Debezium CDC, custom sync. Watch sync lag, error rate, doc-count drift, deletes |
| [Qdrant: keeping Postgres in sync](https://qdrant.tech/documentation/data-synchronization/with-postgres/) | Dual write vs outbox | Dual write only for prototypes (< 10K records). Outbox: "the outbox event exists if and only if the product write succeeded" |
| [DEV: outbox pattern without a relay](https://dev.to/zeybek/the-outbox-pattern-without-a-relay-41oo) | Our "version as the pending flag" variant | The outbox without a separate relay process |
| [django-postgres-elasticsearch](https://www.github.com/rrmerugu-archive/django-postgres-elasticsearch) | Common small-project pattern | Postgres primary, ES secondary, re-indexed on change |
| [ZomboDB (via ecosyste.ms)](https://awesome.ecosyste.ms/projects/110797) | Alternative (not chosen) | A Postgres extension that manages the ES index transactionally (Postgres 12–15) |

## Slack

| Source | Used for | Key data |
|---|---|---|
| [Slack: Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth) | HTTPS + state rules | "The `redirect_uri` must use HTTPS". "If it doesn't match what you sent, consider the authorization a forgery" (state) |
| [Slack: Sending messages using incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks) | Error handling, encryption | Error strings: `action_prohibited`, `channel_is_archived`, `channel_not_found`, `invalid_token`, `invalid_payload`, `no_active_hooks`, `no_service`, `no_team`, `team_disabled`… "Your webhook URL contains a secret". Slack revokes leaked secrets |
| [Slack changelog 2016-05-17](https://docs.slack.dev/changelog/2016-05-17-changes-to-errors-for-incoming-webhooks) | Status codes | Webhook errors moved to HTTP status codes (400/403/404). No clear per-error mapping |
| [Slack legacy OAuth docs](https://API.SLACK.COM/docs/oauth) | Background | Older doc: HTTPS redirect, path must be under the callback URL |
| [Hookdeck: Guide to Slack webhooks](https://hookdeck.com/webhooks/platforms/guide-to-slack-webhooks-features-and-best-practices.md) | Error meanings | `no_service` = webhook disabled/removed/invalid |
| [Ensembl Hive Slack client](https://ensembl-hive.readthedocs.io/en/version-2.5/perl/Slack_8pm_source.html) | Third-party status mapping | Maps `action_prohibited`→403, `channel_not_found`→404, `channel_is_archived`→405 (conflicts with other claims, so we classify by error string) |
| [Chilkat: Slack OAuth2 sample](https://example-code.com/purebasic/slack_oauth2.asp) | localhost workaround | Uses a public HTTPS relay for the redirect |

## Google OAuth

| Source | Used for | Key data |
|---|---|---|
| [google-auth-library: CodeVerifierResults](https://googleapis.dev/nodejs/google-auth-library/latest/interfaces/CodeVerifierResults.html) | PKCE | `generateCodeVerifierAsync()` → `codeChallenge` (for the auth URL) + `codeVerifier` (for `getToken`) |
| [google-auth-library: GenerateAuthUrlOpts](https://googleapis.dev/nodejs/google-auth-library/latest/interfaces/GenerateAuthUrlOpts.html) | PKCE method | The method defaults to `plain` if omitted, so **always pass S256** |
| [Arctic: OAuth2 PKCE guide](https://arcticjs.dev/guides/oauth2-pkce) | Cookie pattern | state + verifier in short-lived httpOnly cookies (10 min), checked on callback |
| [Google Cloud: app verification](https://support.google.com/cloud/answer/13461325?authuser=1) | Testing mode | External apps start in **test mode**, where only listed **test users** can sign in. Publish via "Publish App". Request the narrowest scopes |

## Ethereal

| Source | Used for | Key data |
|---|---|---|
| [Ethereal FAQ](https://ethereal.email/faq) | Senders, limits, retention | Accounts via `nodemailer.createTestAccount()` or one click, "no signup and no verification". "Nothing is actually delivered". "Messages are stored for a few hours". **100MB** quota. **Public accounts: up to 200 messages per hour**, then temporarily rejected until the next hour. Public accounts can't receive inbound mail |

## Not fetched this session (library docs / general knowledge, check while building)

- **BullMQ:** `moveToDelayed(ts, token)` + `DelayedError`, `worker.rateLimit()` + `Worker.RateLimitError()`, `limiter`, stalled jobs (`stalledInterval` 30s, `maxStalledCount`), `removeOnComplete/removeOnFail`, jobId deduplication, `noeviction` requirement. BullMQ Pro groups (paid).
- **Bull Board:** `BullMQAdapter(queue, { readOnlyMode: true })`.
- **Redis:** AOF `appendonly` / `appendfsync everysec`, Lua atomicity, Cluster hash tags.
- **Browsers:** Safari blocks third-party cookies by default, Firefox Total Cookie Protection isolates them, Chrome still allows them. `SameSite` works on the site, not the full domain. Schemeful same-site.
- **Slack:** `<!date^ts^{time}|fallback>` formatting, Block Kit, link buttons need interactivity, `auth.revoke`.
- **Gmail:** the `gmail.send` scope is sensitive (needs verification) and Gmail has daily limits. `rfc822msgid:` search.
- **Audit:** AWS CloudTrail log-file integrity validation (chained digests), WORM archiving for regulated email, Certificate Transparency (Merkle trees).
- **Hosting / deployment:**
  - Google requires HTTPS redirect URIs except for localhost, and its ID tokens expire after about 1 hour.
  - Chrome's schemeful same-site rule means `http` and `https` count as different sites.
  - The `__Host-` cookie prefix rules (`Secure`, `Path=/`, no `Domain`).
  - Caddy obtains and renews Let's Encrypt certificates automatically.
  - Amazon OpenSearch is a fork, and the `@elastic/elasticsearch` client rejects non-Elastic servers (product check).
  - ElastiCache's default `maxmemory-policy` is `volatile-lru`.
  - AWS charges for public IPv4 addresses.
  - GoDaddy limits its DNS API to larger accounts, so automated DNS-01 certificate plugins won't work on small accounts.
  - Elasticsearch on Linux wants `vm.max_map_count=262144`.
  - Free GitHub accounts can't use GitHub Pages on private repos (hence a separate public relay repo).

## Still unverified (confirm during the build)

- [ ] Slack accepts `https://localhost` redirect URLs (else use a tunnel)
- [ ] Which Ethereal IMAP folder holds caught messages, and whether `SEARCH HEADER Message-ID` works there
- [ ] Slack webhook error ↔ HTTP status mapping (we classify by error string anyway)
- [ ] `oauth.v2.access` response fields `incoming_webhook.{url, channel, channel_id, configuration_url}` (not on the fetched page)
- [ ] BullMQ `RateLimitError` keeps the job's place in line (test it)
- [ ] Whether Google apps with only `openid email profile` need verification to publish (Testing + test users is enough for the demo)
- [ ] `generateCodeVerifierAsync` call shape in the current google-auth-library version
- [ ] How long Ethereal accounts last
- [ ] `auth.revoke` disables the incoming webhook
- [ ] BullMQ custom jobId character rules (we avoid `:` and use `-`)
- [ ] Google consent screen: what "Authorized domains" requires for `rottom.your-domain.com` in Testing mode
- [ ] Vite's dev proxy passes `Set-Cookie` and 302 `Location` headers through unchanged for `/auth/*` (expected, but test it)
