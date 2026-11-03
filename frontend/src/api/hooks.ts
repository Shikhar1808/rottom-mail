import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';
import type { AuditEvent, CampaignInput, CampaignResult, Counts, EmailDetail, EmailItem, EmailPage, Me, Sender, SentFilter, Slack } from './types';

const POLL_MS = 5000; // the tabs follow sends live

/** The signed-in user, or null when there's no session. */
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/api/me').catch((err) => (err instanceof ApiError && err.status === 401 ? null : Promise.reject(err))),
    staleTime: 60_000,
  });

export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => api<{ ok: boolean; devLogin: boolean; limitWindow: string }>('/api/health') });

export const useEmails = (tab: 'scheduled' | 'sent', status: SentFilter | null = null) =>
  useInfiniteQuery({
    queryKey: ['emails', tab, status],
    queryFn: ({ pageParam }) => api<EmailPage>(`/api/emails?tab=${tab}${status ? `&status=${status}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: POLL_MS,
  });

export const useSearch = (q: string) =>
  useQuery({
    queryKey: ['search', q],
    queryFn: () => api<{ items: EmailItem[] }>(`/api/emails/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
    refetchInterval: POLL_MS,
  });

export const useCounts = () => useQuery({ queryKey: ['emails', 'counts'], queryFn: () => api<Counts>('/api/emails/counts'), refetchInterval: POLL_MS });

export const useEmail = (id: string) =>
  useQuery({ queryKey: ['emails', 'one', id], queryFn: () => api<EmailDetail>(`/api/emails/${id}`), refetchInterval: POLL_MS });

export const useHistory = (emailId: string) =>
  useQuery({ queryKey: ['emails', 'history', emailId], queryFn: () => api<{ items: AuditEvent[] }>(`/api/emails/${emailId}/events`), refetchInterval: POLL_MS });

// The first call creates the user's Ethereal mailboxes, which can take a few seconds.
export const useSenders = () => useQuery({ queryKey: ['senders'], queryFn: () => api<{ items: Sender[] }>('/api/senders'), staleTime: 60_000 });

export const useSlack = () => useQuery({ queryKey: ['slack'], queryFn: () => api<Slack>('/api/slack') });

export function useSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CampaignInput) => api<CampaignResult>('/api/campaigns', { json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  });
}

export function useRetry() {
  const qc = useQueryClient();
  return useMutation({
    // result 'sent': the mailbox check found the first try, so nothing was sent again.
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => api<{ result: 'sent' | 'queued' }>(`/api/emails/${id}/retry`, { json: { force } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  });
}

export function useDisconnectSlack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/api/slack', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['slack'] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { json: {} }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  });
}
