import crypto from 'node:crypto';
import { env } from './config';

const key = () => Buffer.from(env.ENCRYPTION_KEY, 'base64');

// AES-256-GCM, stored as "iv.tag.ciphertext" (base64). The auth tag makes any tampering fail on decrypt.
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('bad ciphertext format');
  const [iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
