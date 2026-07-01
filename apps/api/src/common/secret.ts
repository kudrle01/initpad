import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { config } from '../config';

// Šifrování citlivých hodnot (Gitea tokeny) v DB pomocí AES-256-GCM.
// Formát: "enc:v1:<base64(iv|tag|ciphertext)>". Staré plaintext hodnoty
// (bez prefixu) se vrací beze změny → zpětná kompatibilita bez migrace.
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
    // Šifrováno jiným klíčem (změnil se INITPAD_ENCRYPTION_KEY). Token je dnes
    // jen fallback – git operace jedou přes admin token + Sudo, takže vracíme
    // prázdno místo pádu.
    return '';
  }
}
