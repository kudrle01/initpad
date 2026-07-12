import { decryptSecret, encryptSecret } from './secret';

describe('secret (AES-256-GCM)', () => {
  it('round-trips a value', () => {
    const enc = encryptSecret('hunter2');
    expect(enc).not.toBe('hunter2');
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(enc)).toBe('hunter2');
  });

  it('passes legacy plaintext (no prefix) through unchanged', () => {
    expect(decryptSecret('plain-token')).toBe('plain-token');
  });

  it('produces different ciphertexts for the same input (random IV)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });
});
