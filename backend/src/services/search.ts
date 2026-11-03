import { Client } from '@elastic/elasticsearch';
import type { EmailStatus } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/db';
import { chunk } from '../utils/helpers';

// Fail fast: the sync worker already retries through BullMQ, and a search box shouldn't hang for seconds when ES is down.
export const es = new Client({ node: env.ELASTICSEARCH_URL, maxRetries: 1, requestTimeout: 5000 });
const INDEX = 'emails';

let ready: Promise<unknown> | undefined;

/**
 * Creates the index with our mapping if it's missing. Called by the API on boot and by the sync worker before its
 * first write: otherwise ES would auto-create the index with guessed field types. Retried on the next call if it fails.
 */
export function ensureIndex() {
  return (ready ??= (async () => {
    if (await es.indices.exists({ index: INDEX })) return;
    await es.indices
      .create({
        index: INDEX,
        settings: { analysis: { analyzer: { email_parts: { type: 'pattern', pattern: '[^a-z0-9]+' } } } }, // john@acme.com → john, acme, com
        mappings: {
          dynamic: 'strict',
          properties: {
            userId: { type: 'keyword' },
            campaignId: { type: 'keyword' },
            status: { type: 'keyword' },
            senderEmail: { type: 'keyword' },
            toEmail: { type: 'text', analyzer: 'email_parts', fields: { keyword: { type: 'keyword' } } },
            subject: { type: 'text' },
            body: { type: 'text' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
          },
        },
      })
      .catch((err) => {
        if (err?.body?.error?.type !== 'resource_already_exists_exception') throw err; // another process won the race
      });
  })().catch((err) => {
    ready = undefined;
    throw err;
  }));
}

/**
 * Copies the latest version of these rows into ES. `version_type: external` makes ES ignore anything older than what
 * it has, so jobs can run twice or out of order. Then marks the rows as indexed (bookkeeping only: no version bump).
 */
export async function syncEmails(ids: string[]) {
  await ensureIndex();
  for (const part of chunk(ids, 500)) {
    const rows = await prisma.email.findMany({
      where: { id: { in: part } },
      include: { campaign: { select: { subject: true, body: true } }, sender: { select: { email: true } } },
    });
    if (!rows.length) continue; // deleted rows: nothing to copy
    const res = await es.bulk({
      operations: rows.flatMap((r) => [
        { index: { _index: INDEX, _id: r.id, version: r.version, version_type: 'external' as const } },
        {
          userId: r.userId,
          campaignId: r.campaignId,
          status: r.status,
          senderEmail: r.sender.email,
          toEmail: r.toEmail,
          subject: r.campaign.subject,
          body: r.campaign.body.slice(0, 2000), // every lead gets a copy: the whole message × 10k leads would fill ES
          scheduledAt: r.scheduledAt,
          sentAt: r.sentAt,
        },
      ]),
    });
    // 409 = ES already has this version or a newer one: that's success.
    const failed = res.items.filter((i) => i.index?.error && i.index.status !== 409);
    if (failed.length) throw new Error(`ES bulk: ${failed.length} of ${rows.length} failed, e.g. ${failed[0].index?.error?.reason}`);
    await prisma.$executeRaw`
      UPDATE "Email" AS e SET "indexedVersion" = v.version
      FROM unnest(${rows.map((r) => r.id)}::text[], ${rows.map((r) => r.version)}::int[]) AS v(id, version)
      WHERE e.id = v.id AND e."indexedVersion" < v.version`;
  }
}

/** "ES finds, Postgres shows": ES ranks the ids, the rows (and their always-current status) come from Postgres. */
export async function searchEmailIds(userId: string, q: string, status?: EmailStatus) {
  await ensureIndex();
  const res = await es.search<unknown>({
    index: INDEX,
    size: 50,
    _source: false,
    query: {
      bool: {
        filter: [{ term: { userId } }, ...(status ? [{ term: { status } }] : [])], // userId from the session only
        must: {
          bool: {
            should: [
              // operator 'and': every word must match, so "lead07@example.com" doesn't return every @example.com email.
              // Typos are forgiven in subject and body only: in addresses one digit is the whole difference (lead07 vs lead01).
              { multi_match: { query: q, fields: ['subject^2', 'body'], fuzziness: 'AUTO', operator: 'and' } },
              { match: { toEmail: { query: q, operator: 'and', boost: 2 } } },
              { multi_match: { query: q, type: 'bool_prefix', fields: ['toEmail', 'subject'], operator: 'and' } }, // "joh" while typing
            ],
            minimum_should_match: 1,
          },
        },
      },
    },
    sort: ['_score', { scheduledAt: 'desc' }],
  });
  return res.hits.hits.map((h) => h._id!);
}
