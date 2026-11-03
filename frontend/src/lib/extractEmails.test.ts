import { describe, expect, it } from 'vitest';
import { extractEmails } from './extractEmails';

describe('extractEmails', () => {
  it('finds addresses in any CSV column, lowercases them and drops duplicates', () => {
    const csv = 'name,email,company\nAda,Ada@Example.com,"Acme, Inc"\nBob,bob@mail.co.uk,x\n"Ada again",ada@example.com,\nno email here,,';
    expect(extractEmails(csv)).toEqual({ emails: ['ada@example.com', 'bob@mail.co.uk'], duplicates: 1 });
  });

  it('reads one-per-line text files and ignores things that only look like addresses', () => {
    expect(extractEmails('a@b.io\r\nnot-an-email@\n@missing.com\nc.d+tag@sub.domain.dev\n').emails).toEqual(['a@b.io', 'c.d+tag@sub.domain.dev']);
  });
});
