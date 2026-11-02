import nodemailer, { type Transporter } from 'nodemailer';
import type { Sender } from '@prisma/client';
import { env } from '../config';
import { decrypt } from '../crypto';

const pools = new Map<string, Transporter>();
let fake: Transporter | undefined;

// One pooled SMTP connection set per sender, reused for every email from it.
export function transportFor(sender: Sender): Transporter {
  if (env.SMTP_MODE === 'fake') return (fake ??= nodemailer.createTransport({ jsonTransport: true }));
  let t = pools.get(sender.id);
  if (!t) {
    t = nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: sender.smtpPort === 465,
      auth: { user: sender.smtpUser, pass: decrypt(sender.smtpPassEnc) },
      pool: true,
      maxConnections: 2,
    });
    pools.set(sender.id, t);
  }
  return t;
}

export function closeTransports() {
  for (const t of pools.values()) t.close();
  pools.clear();
}
