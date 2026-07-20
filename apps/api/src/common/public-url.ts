// GitHub-hosted runners can call only a network-reachable platform endpoint.
// Reject the common local/private values before provisioning a repository whose
// first workflow would be guaranteed to fail (and before sending a bearer
// token over cleartext HTTP).
export function publicHttpsUrlIssue(raw: string): string | null {
  if (!raw.trim()) return 'INITPAD_PLATFORM_PUBLIC_URL is not configured.';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:') return 'The GitHub CI callback must use HTTPS.';
    if (url.username || url.password) return 'The GitHub CI callback URL must not contain credentials.';
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::' ||
      host === '::1' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return 'The GitHub CI callback must be reachable from the public internet, not a local or private address.';
    }
    return null;
  } catch {
    return 'INITPAD_PLATFORM_PUBLIC_URL must be a valid HTTPS URL.';
  }
}
