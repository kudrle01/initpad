import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export class UnsafeOutboundDestinationError extends Error {
  constructor(message = 'Outbound destination is not allowed by the hosted network policy') {
    super(message);
    this.name = 'UnsafeOutboundDestinationError';
  }
}

const NON_PUBLIC_V4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC_V4.addSubnet(network, prefix, 'ipv4');
}
const NON_PUBLIC_V6 = new BlockList();
for (const [network, prefix] of [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC_V6.addSubnet(network, prefix, 'ipv6');
}

function normalizedHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
}

export function isPublicInternetAddress(raw: string): boolean {
  const address = normalizedHostname(raw);
  if (address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !NON_PUBLIC_V4.check(address, 'ipv4');
  if (family === 6) return !NON_PUBLIC_V6.check(address, 'ipv6');
  return false;
}

const systemResolver: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
};

async function resolveWithin(
  hostname: string,
  resolver: HostResolver,
  timeoutMs: number,
): Promise<readonly ResolvedAddress[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      resolver(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new UnsafeOutboundDestinationError('Outbound DNS lookup timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve one hostname once, reject the entire answer when any address is not
 * globally routable, and return the address that the caller must pin for the
 * actual socket. Checking all answers prevents a public+private mixed response
 * from becoming a resolver-order bypass.
 */
export async function resolvePublicInternetHost(
  rawHostname: string,
  resolver: HostResolver = systemResolver,
  timeoutMs = 3_000,
): Promise<ResolvedAddress> {
  const hostname = normalizedHostname(rawHostname);
  const literalFamily = isIP(hostname);
  const addresses: readonly ResolvedAddress[] = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await resolveWithin(hostname, resolver, timeoutMs).catch((error: unknown) => {
        if (error instanceof UnsafeOutboundDestinationError) throw error;
        throw new UnsafeOutboundDestinationError('Outbound hostname could not be resolved');
      });

  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) => family !== isIP(address) || !isPublicInternetAddress(address),
    )
  ) {
    throw new UnsafeOutboundDestinationError();
  }
  return addresses[0];
}

export interface BoundedHttpResult {
  ok: boolean;
  status: number;
}

/**
 * A bounded, no-redirect GET used only for deployment health/protection
 * probes. In hosted mode the destination is resolved and pinned before opening
 * the socket, while TLS verification and the Host header retain the requested
 * hostname. Response bodies are never buffered.
 */
export async function boundedHttpGet(
  rawUrl: string,
  options: { publicInternetOnly: boolean; timeoutMs?: number },
): Promise<BoundedHttpResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeOutboundDestinationError('Outbound URL must be a clean HTTP(S) address');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new UnsafeOutboundDestinationError('Outbound URL must be a clean HTTP(S) address');
  }
  const requestedHostname = normalizedHostname(url.hostname);
  const destination = options.publicInternetOnly
    ? await resolvePublicInternetHost(requestedHostname)
    : { address: requestedHostname, family: isIP(requestedHostname) as 0 | 4 | 6 };
  const timeoutMs = options.timeoutMs ?? 3_000;
  const requestOptions: RequestOptions = {
    protocol: url.protocol,
    hostname: destination.address,
    ...(destination.family ? { family: destination.family } : {}),
    port: url.port || undefined,
    method: 'GET',
    path: `${url.pathname}${url.search}`,
    headers: { host: url.host, connection: 'close' },
  };

  return await new Promise<BoundedHttpResult>((resolve, reject) => {
    const onResponse = (response: { statusCode?: number; destroy(): void }) => {
      const status = response.statusCode ?? 0;
      response.destroy();
      resolve({ status, ok: status >= 200 && status < 300 });
    };
    const request =
      url.protocol === 'https:'
        ? httpsRequest(
            {
              ...requestOptions,
              ...(isIP(requestedHostname) ? {} : { servername: requestedHostname }),
            },
            onResponse,
          )
        : httpRequest(requestOptions, onResponse);
    request.once('error', reject);
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error('Outbound HTTP probe timed out')),
    );
    request.end();
  });
}
