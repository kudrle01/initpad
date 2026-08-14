import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ROUTE_HASH_LENGTH = 12;

/** Validates and canonicalizes the administrator-confirmed gateway DNS zone. */
export function normalizeManagedGatewayOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException(
      'Managed gateway base URL must be an HTTPS DNS origin without credentials, path, query or fragment',
    );
  }

  const hostname = url.hostname.toLowerCase();
  const labels = hostname.split('.');
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.pathname !== '/'
    || url.search
    || url.hash
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || isIP(hostname) !== 0
    || hostname.length > 253
    || labels.some((label) => !DNS_LABEL.test(label))
  ) {
    throw new BadRequestException(
      'Managed gateway base URL must be an HTTPS DNS origin without credentials, path, query or fragment',
    );
  }
  return url.origin.toLowerCase();
}

/**
 * Resolves the allocation's optional sub-zone while preventing it from
 * escaping the administrator-confirmed target DNS zone.
 */
export function managedGatewayOrigin(
  targetPublicUrl: string | null,
  allocationPublicUrl: string | null,
): string {
  if (!targetPublicUrl) {
    throw new BadRequestException('Managed gateway target has no HTTPS base URL');
  }
  const targetOrigin = normalizeManagedGatewayOrigin(targetPublicUrl);
  const allocationOrigin = allocationPublicUrl
    ? normalizeManagedGatewayOrigin(allocationPublicUrl)
    : targetOrigin;
  const targetHost = new URL(targetOrigin).hostname;
  const allocationHost = new URL(allocationOrigin).hostname;
  if (allocationHost !== targetHost && !allocationHost.endsWith(`.${targetHost}`)) {
    throw new BadRequestException(
      'Managed gateway allocation URL must stay inside the target DNS zone',
    );
  }
  return allocationOrigin;
}

/** Stable DNS name: readable prefix plus an immutable environment-id digest. */
export function stableGatewayHostname(
  projectName: string,
  environmentName: string,
  environmentId: string,
  gatewayOrigin: string,
): string {
  const baseHost = new URL(normalizeManagedGatewayOrigin(gatewayOrigin)).hostname;
  const digest = createHash('sha256').update(environmentId).digest('hex').slice(0, ROUTE_HASH_LENGTH);
  const readable = `${projectName}-${environmentName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';
  const maxReadable = 63 - ROUTE_HASH_LENGTH - 1;
  const prefix = readable.slice(0, maxReadable).replace(/-+$/g, '') || 'app';
  const hostname = `${prefix}-${digest}.${baseHost}`;
  if (hostname.length > 253) {
    throw new BadRequestException('Managed gateway DNS zone is too long for an application hostname');
  }
  return hostname;
}
