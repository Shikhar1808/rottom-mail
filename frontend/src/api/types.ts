// Shapes returned by the backend routes (backend/src/routes).
export type Me = { id: string; name: string; email: string; avatarUrl: string | null; isAdmin: boolean };

export type Sender = { id: string; email: string; status: 'active' | 'broken'; createdAt: string };

export type EmailStatus = 'scheduled' | 'sending' | 'sent' | 'failed' | 'needs_check';

export type EmailItem = {
  id: string;
  toEmail: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  previewUrl: string | null;
  error: string | null;
  subject: string;
  from: string;
  preview: string; // the start of the message
};

export type AttachmentInfo = { id: string; filename: string; contentType: string; size: number };

export type EmailDetail = Omit<EmailItem, 'preview'> & { body: string; html: string | null; attachments: AttachmentInfo[] };

export type EmailPage = { items: EmailItem[]; nextCursor: string | null };

export type Counts = { scheduled: number; sent: number };

/** Sent-tab filter: the statuses that tab holds. */
export type SentFilter = 'sent' | 'failed' | 'needs_check';

export type AuditEvent = {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type Slack =
  | { connected: false }
  | { connected: true; status: 'active' | 'broken'; teamName: string; channel: string; lastError: string | null };

export type CampaignInput = {
  campaignId: string;
  senderId: string;
  subject: string;
  body: string; // plain text
  html?: string; // the formatted version
  attachments?: { filename: string; contentType: string; content: string }[]; // content in base64
  leads: string[];
  startAt: string;
  delayMs: number;
  hourlyLimit: number;
};

export type CampaignResult = { campaignId: string; count: number; duplicatesRemoved: number; firstSendAt: string; lastSendAt: string };
