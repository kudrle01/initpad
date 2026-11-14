/**
 * Turns the opaque `fetch failed` from undici into the cause an operator can
 * act on. Only the error code is used: messages may echo request details.
 */
export function describeFetchFailure(error: unknown, timeoutLabel = 'timed out'): string {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const cause =
    record.cause && typeof record.cause === 'object'
      ? (record.cause as Record<string, unknown>)
      : {};
  const code =
    typeof cause.code === 'string'
      ? cause.code
      : typeof record.code === 'string'
        ? record.code
        : '';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return `DNS lookup failed (${code}); check the host name and the server's DNS resolver`;
  }
  if (
    [
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    ].includes(code)
  ) {
    return `TLS verification failed (${code}); the certificate is not trusted for this name, install its CA (--ca-file) or fix the certificate`;
  }
  if (code === 'ECONNREFUSED') return 'connection refused (ECONNREFUSED); nothing listens there';
  if (['ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(code)) {
    return `connection failed (${code})`;
  }
  if (
    record.name === 'TimeoutError' ||
    record.name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return timeoutLabel;
  }
  return code ? `request failed (${code})` : 'request failed before an HTTP response';
}
