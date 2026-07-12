import { generateToken, hashToken, tokenMatches } from './token';

describe('CI tokens', () => {
  it('generates independent high-entropy URL-safe values', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('compares only against the stored hash', () => {
    const token = generateToken();
    expect(tokenMatches(token, hashToken(token))).toBe(true);
    expect(tokenMatches(`${token}x`, hashToken(token))).toBe(false);
    expect(tokenMatches('', hashToken(token))).toBe(false);
    expect(tokenMatches(token, null)).toBe(false);
  });
});
