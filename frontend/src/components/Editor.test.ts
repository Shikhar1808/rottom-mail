import { describe, expect, it } from 'vitest';
import { toLink } from './Editor';

describe('toLink (the editor link box)', () => {
  it('fills in the scheme for plain addresses', () => {
    expect(toLink('example.com/pricing')).toBe('https://example.com/pricing');
    expect(toLink('sam@example.com')).toBe('mailto:sam@example.com');
    expect(toLink('http://example.com')).toBe('http://example.com');
  });

  it('refuses anything that is not a web or mail link', () => {
    expect(toLink('javascript:alert(1)')).toBeNull();
    expect(toLink('data:text/html,hi')).toBeNull();
    expect(toLink('not a link')).toBeNull();
    expect(toLink('   ')).toBeNull();
  });
});
