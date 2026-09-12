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
    if (url.username || url.password)
      return 'The GitHub CI callback URL must not contain credentials.';
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

export function publicHostname(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname
      ? url.hostname
      : null;
  } catch {
    return null;
  }
}

export function builtInPublicHost(
  publicUrl: string | undefined,
  deploymentOverride: string | undefined,
  legacyHost: string | undefined,
): string {
  return (
    deploymentOverride?.trim() || publicHostname(publicUrl) || legacyHost?.trim() || 'localhost'
  );
}

// Built-in targets publish through the InitPad host. Their persisted URL keeps
// the allocated port/path, but a VM can receive a different LAN address after
// reboot or switching from host-only to bridged networking. Render those URLs
// with the currently configured public host; user-owned target URLs remain
// untouched because they may intentionally live on another server.
export function withCurrentPublicHost(raw: string | null, publicHost: string): string | null {
  if (!raw || !publicHost.trim()) return raw;
  try {
    const url = new URL(raw);
    const hostname = publicHost.trim().replace(/^\[|\]$/g, '');
    url.hostname = hostname.includes(':') ? `[${hostname}]` : hostname;
    const rewritten = url.toString();
    return !raw.endsWith('/') && url.pathname === '/' && !url.search && !url.hash
      ? rewritten.replace(/\/$/, '')
      : rewritten;
  } catch {
    return raw;
  }
}
