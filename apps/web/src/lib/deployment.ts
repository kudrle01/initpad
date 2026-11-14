import { t } from '@/i18n';
import { translateApiMessage } from '@/lib/api-messages';

export function cleanupNotice(reason: string): string {
  if (!reason.startsWith('Cleanup pending:')) return translateApiMessage(reason);
  const detail = reason
    .replace(/^Cleanup pending:\s*/, '')
    .replace(/^Public deployment removed\.\s*/, '')
    .replace(/^Its canonical path is free for reuse\.\s*/, '');
  return t(
    'Public deployment removed; its URL path and project name are free for reuse. {detail}',
    { detail: translateApiMessage(detail) },
  );
}
