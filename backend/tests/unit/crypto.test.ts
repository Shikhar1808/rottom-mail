import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

let mod: typeof import('../../src/utils/crypto');

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.DATABASE_URL ??= 'postgresql://unused';
  process.env.APP_URL ??= 'https://localhost:5173';
  mod = await import('../../src/utils/crypto');
});

describe('encrypt / decrypt', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = mod.encrypt('hooks.slack.com/services/secret');
    const b = mod.encrypt('hooks.slack.com/services/secret');
    expect(a).not.toEqual(b);
    expect(mod.decrypt(a)).toBe('hooks.slack.com/services/secret');
  });

  it('rejects tampered ciphertext', () => {
    const [iv, tag, data] = mod.encrypt('password').split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => mod.decrypt([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });
});
