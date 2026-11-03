import { describe, expect, it } from 'vitest';
import { errorFields } from '../../src/lib/log';

describe('errorFields', () => {
  it('names each failed connection attempt instead of an empty reason', () => {
    // What Node gives when every address of a host fails (the "reason:" left empty in the Google login error).
    const attempts = new AggregateError(
      [Object.assign(new Error('connect ETIMEDOUT 2404:6800::5f:443'), { code: 'ETIMEDOUT', address: '2404:6800::5f', port: 443 }), Object.assign(new Error('x'), { code: 'ETIMEDOUT', address: '192.178.158.95', port: 443 })],
      '',
    );
    const err = Object.assign(new Error('request to https://oauth2.googleapis.com/token failed, reason: '), { code: 'ETIMEDOUT', cause: attempts });
    const f = errorFields(err);
    expect(f.error).toBe('ETIMEDOUT request to https://oauth2.googleapis.com/token failed, reason: ');
    expect(f.cause).toBe('AggregateError [ETIMEDOUT 2404:6800::5f:443, ETIMEDOUT 192.178.158.95:443]');
  });

  it("keeps the server's reply and status, and never the request settings with secrets", () => {
    const err = Object.assign(new Error('invalid_grant'), {
      config: { data: 'client_secret=SECRET123&code=CODE456' },
      response: { status: 400, data: { error: 'invalid_grant', error_description: 'Bad Request' }, config: { data: 'client_secret=SECRET123' } },
    });
    const f = errorFields(err);
    expect(f).toMatchObject({ error: 'invalid_grant', status: 400, reply: 'Bad Request' });
    expect(JSON.stringify(f)).not.toMatch(/SECRET123|CODE456/);
  });

  it('reads SMTP errors from nodemailer', () => {
    const err = Object.assign(new Error('Message failed: 550 Mailbox unavailable'), { code: 'EMESSAGE', responseCode: 550, response: '550 Mailbox unavailable' });
    expect(errorFields(err)).toMatchObject({ error: 'EMESSAGE Message failed: 550 Mailbox unavailable', status: 550, reply: '550 Mailbox unavailable' });
  });
});
