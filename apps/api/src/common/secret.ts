import { InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { config } from '../config';

/**
 * Encryption of sensitive values stored in the database (target credentials,
 * Gitea tokens, provider user access/refresh tokens, secret application
 * configuration and queued e-mail payloads), using AES-256-GCM.
 *
 * Stored format: "enc:v1:<base64(iv | authTag | ciphertext)>". The GCM tag
 * identifies the key: values are written with INITPAD_ENCRYPTION_KEY and
 * also read with the keys in INITPAD_ENCRYPTION_KEY_PREVIOUS while a rotation
 * re-encrypts them (ADR-141). Legacy plaintext values (no prefix) stay
 * readable until that re-encryption converts them.
 */
const PREFIX = 'enc:v1:';

let derived: { source: string; keys: Buffer[] } | undefined;

function keys(): Buffer[] {
  const secrets = [config.security.encryptionKey, ...config.security.previousEncryptionKeys];
  const source = secrets.join('\n');
  if (derived?.source !== source) {
    derived = {
      source,
      keys: secrets.map((secret) => scryptSync(secret, 'initpad-secret-salt', 32)),
    };
  }
  return derived.keys;
}

/** A stored value that none of the configured keys can decrypt. */
export class SecretDecryptionError extends InternalServerErrorException {
  constructor(what = 'A stored credential') {
    super(`${what} cannot be decrypted with the configured INITPAD_ENCRYPTION_KEY`);
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys()[0], iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptWith(key: Buffer, raw: Buffer): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Decrypts a stored value. A value that no configured key opens throws
 * instead of turning into an empty credential, so a changed key surfaces as
 * an explicit error rather than as failed logins or unconfigured secrets.
 */
export function decryptSecret(stored: string, what?: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  for (const key of keys()) {
    const plaintext = decryptWith(key, raw);
    if (plaintext !== null) return plaintext;
  }
  throw new SecretDecryptionError(what);
}

/**
 * For callers that can recover by obtaining a new credential, such as issuing
 * a fresh Git token or asking the user to link GitHub again.
 */
export function readableSecret(stored: string): string | null {
  try {
    return decryptSecret(stored);
  } catch (error) {
    if (error instanceof SecretDecryptionError) return null;
    throw error;
  }
}

/**
 * Returns the value encrypted with the current key when it is still stored as
 * plaintext or under a previous key, null when it is already current, and
 * throws SecretDecryptionError when no configured key opens it.
 */
export function reencryptedSecret(stored: string): string | null {
  if (!stored) return null;
  if (stored.startsWith(PREFIX)) {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    if (decryptWith(keys()[0], raw) !== null) return null;
  }
  return encryptSecret(decryptSecret(stored));
}
