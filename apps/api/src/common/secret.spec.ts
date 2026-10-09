import { config } from '../config';
import {
  decryptSecret,
  encryptSecret,
  readableSecret,
  reencryptedSecret,
  SecretDecryptionError,
} from './secret';

describe('secret (AES-256-GCM)', () => {
  const original = {
    key: config.security.encryptionKey,
    previous: config.security.previousEncryptionKeys,
  };
  afterEach(() => {
    config.security.encryptionKey = original.key;
    config.security.previousEncryptionKeys = original.previous;
  });

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

  it('fails loudly instead of returning an empty credential after a key change', () => {
    config.security.encryptionKey = 'old-key-0123456789abcdef0123456789';
    const stored = encryptSecret('sftp-password');
    config.security.encryptionKey = 'new-key-0123456789abcdef0123456789';

    expect(() => decryptSecret(stored, "The credential of target 'eso'")).toThrow(
      new SecretDecryptionError("The credential of target 'eso'"),
    );
    expect(readableSecret(stored)).toBeNull();
  });

  it('reads values under a previous key and re-encrypts them with the current one', () => {
    config.security.encryptionKey = 'old-key-0123456789abcdef0123456789';
    const old = encryptSecret('github-token');
    config.security.encryptionKey = 'new-key-0123456789abcdef0123456789';
    config.security.previousEncryptionKeys = ['old-key-0123456789abcdef0123456789'];

    expect(decryptSecret(old)).toBe('github-token');
    const rotated = reencryptedSecret(old);
    expect(rotated).not.toBeNull();
    expect(reencryptedSecret(rotated!)).toBeNull();

    config.security.previousEncryptionKeys = [];
    expect(decryptSecret(rotated!)).toBe('github-token');
  });

  it('encrypts legacy plaintext and leaves empty values alone', () => {
    const converted = reencryptedSecret('legacy-plaintext');
    expect(converted?.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(converted!)).toBe('legacy-plaintext');
    expect(reencryptedSecret('')).toBeNull();
  });
});
