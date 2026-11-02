import type { Job } from 'bullmq';
import { prisma } from '../db';
import type { SearchSyncJob } from '../queues';
import { syncEmails } from '../services/search';

// One email (after each change), a whole campaign (after scheduling) or a batch (startup repair).
export async function processSearchSync(job: Job<SearchSyncJob>) {
  const d = job.data;
  if ('emailId' in d) return syncEmails([d.emailId]);
  if ('emailIds' in d) return syncEmails(d.emailIds);
  const rows = await prisma.email.findMany({ where: { campaignId: d.campaignId }, select: { id: true } });
  return syncEmails(rows.map((r) => r.id));
}
