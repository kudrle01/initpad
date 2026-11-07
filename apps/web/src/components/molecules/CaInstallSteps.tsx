import { Disclosure } from '@/components/molecules/Disclosure';
import { t } from '@/i18n';

/** `ab12…` → `AB:12:…`, the form `openssl` and browsers show. */
export function formatFingerprint(sha256: string): string {
  return (sha256.toUpperCase().match(/.{2}/g) ?? []).join(':');
}

// How to trust a downloaded CA root in the common browsers and how to check
// the file against the fingerprint shown next to it (ADR-161, ADR-166).
export function CaInstallSteps({ fileName, className }: { fileName: string; className?: string }) {
  return (
    <Disclosure summary={t('How to install the certificate')} className={className}>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>
          {t(
            'Windows: open the file → Install Certificate → Local Machine → Trusted Root Certification Authorities.',
          )}
        </li>
        <li>
          {t(
            'macOS: double-click the file, add it to Keychain Access (System) and set it to Always Trust.',
          )}
        </li>
        <li>
          {t('Firefox: Settings → Privacy & Security → View Certificates → Authorities → Import.')}
        </li>
        <li>
          {t('Check the fingerprint: {command}', {
            command: `openssl x509 -in ${fileName} -noout -fingerprint -sha256`,
          })}
        </li>
      </ul>
    </Disclosure>
  );
}
