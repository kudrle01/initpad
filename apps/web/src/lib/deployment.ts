export function cleanupNotice(reason: string): string {
  if (!reason.startsWith('Cleanup pending:')) return reason;
  const detail = reason
    .replace(/^Cleanup pending:\s*/, '')
    .replace(/^Public deployment removed\.\s*/, '')
    .replace(/^Its canonical path is free for reuse\.\s*/, '');
  return `Public deployment removed; its URL path and project name are free for reuse. ${detail}`;
}
