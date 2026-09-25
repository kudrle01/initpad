/** Canonical form used for local usernames, e-mail addresses and identity lookups. */
export function normalizeAccountIdentifier(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** PostgreSQL case-insensitive equality without relying on the process locale. */
export function accountIdentifierEquals(value: string) {
  return {
    equals: normalizeAccountIdentifier(value),
    mode: 'insensitive' as const,
  };
}
