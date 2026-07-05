import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { config } from '../config';

/**
 * Encryption of sensitive values stored in the database (Gitea tokens),
 * using AES-256-GCM.
 *
 * Stored format: "enc:v1:<base64(iv | authTag | ciphertext)>". Legacy plaintext
 * values (no prefix) are returned unchanged, which keeps old rows readable
 * without a data migration.
 */
const PREFIX = 'enc:v1:';
const key = scryptSync(config.security.encryptionKey, 'initpad-secret-salt', 32);

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // The value was encrypted with a different key (INITPAD_ENCRYPTION_KEY
    // changed). The per-user token is only a fallback these days — Git
    // operations run through the service account (admin token + Sudo) — so
    // returning an empty string is safer than failing the whole request.
    return '';
  }
}
