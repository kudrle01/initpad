import { createHmac } from 'crypto';
import { config } from '../config';

export interface StoredAgentConfigVariable {
  key: string;
  value: string;
  isSecret: boolean;
}

/**
 * Binds one Agent job to the exact encrypted-at-rest config snapshot that was
 * current when it was queued. The fingerprint reveals neither secret values
 * nor whether two installations use the same secret because it is keyed with
 * the control-plane encryption key.
 */
export function agentConfigFingerprint(variables: readonly StoredAgentConfigVariable[]): string {
  const hmac = createHmac('sha256', config.security.encryptionKey);
  for (const variable of [...variables].sort((a, b) => a.key.localeCompare(b.key))) {
    hmac.update(variable.key);
    hmac.update('\0');
    hmac.update(variable.isSecret ? 'secret' : 'plain');
    hmac.update('\0');
    hmac.update(variable.value);
    hmac.update('\0');
  }
  return hmac.digest('hex');
}
