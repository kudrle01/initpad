import { lookup } from 'node:dns/promises';

const ROUTES_PATH = '/config/apps/http/servers/initpad/routes';
const MAX_ROUTE_COUNT = 10_000;
const MAX_RECONCILE_ATTEMPTS = 5;

type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
type CaddyRoute = Record<string, unknown>;

export interface CaddyRouteIntent {
  id: string;
  hostname: string;
  upstream: string;
  present: boolean;
}

function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function routeHostname(route: CaddyRoute): string | null {
  const match = route.match;
  if (!Array.isArray(match) || match.length !== 1) return null;
  const matcher = match[0];
  if (!matcher || typeof matcher !== 'object' || Array.isArray(matcher)) return null;
  const hosts = (matcher as Record<string, unknown>).host;
  return Array.isArray(hosts) && hosts.length === 1 && typeof hosts[0] === 'string'
    ? hosts[0]
    : null;
}

function routeUpstream(route: CaddyRoute): string | null {
  if (route.terminal !== true || !Array.isArray(route.handle) || route.handle.length !== 1) return null;
  const handler = route.handle[0];
  if (!handler || typeof handler !== 'object' || Array.isArray(handler)) return null;
  const record = handler as Record<string, unknown>;
  if (record.handler !== 'reverse_proxy' || !Array.isArray(record.upstreams) || record.upstreams.length !== 1) {
    return null;
  }
  const upstream = record.upstreams[0];
  if (!upstream || typeof upstream !== 'object' || Array.isArray(upstream)) return null;
  const dial = (upstream as Record<string, unknown>).dial;
  return typeof dial === 'string' ? dial : null;
}

function managedRoute(intent: CaddyRouteIntent): CaddyRoute {
  return {
    '@id': intent.id,
    match: [{ host: [intent.hostname] }],
    handle: [{
      handler: 'reverse_proxy',
      upstreams: [{ dial: intent.upstream }],
    }],
    terminal: true,
  };
}

export class CaddyAdminClient {
  private origin?: URL;

  constructor(
    private readonly adminUrl = process.env.INITPAD_AGENT_GATEWAY_ADMIN_URL ?? '',
    private readonly resolve: Resolver = (hostname) => lookup(hostname, { all: true }),
    private readonly request: typeof fetch = fetch,
  ) {}

  async ready(signal: AbortSignal): Promise<void> {
    await this.readRoutes(signal);
  }

  async reconcileRoute(intent: CaddyRouteIntent, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt += 1) {
      const current = await this.readRoutes(signal);
      const ownedIndex = current.routes.findIndex((route) => route['@id'] === intent.id);
      if (ownedIndex >= 0) {
        const existingHostname = routeHostname(current.routes[ownedIndex]);
        if (existingHostname !== intent.hostname) {
          throw new Error('Caddy route identity is already bound to another hostname');
        }
      }

      const ownedRoutes = current.routes.filter((route) => route['@id'] === intent.id);
      if (
        intent.present
        && ownedRoutes.length === 1
        && routeHostname(ownedRoutes[0]) === intent.hostname
        && routeUpstream(ownedRoutes[0]) === intent.upstream
      ) return;
      if (!intent.present && ownedRoutes.length === 0) return;

      const next = current.routes.filter((route) => route['@id'] !== intent.id);
      if (intent.present) next.push(managedRoute(intent));

      const response = await this.fetch(ROUTES_PATH, {
        method: 'PATCH',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'if-match': current.etag,
        },
        body: JSON.stringify(next),
      }, signal);
      if (response.status === 412) continue;
      if (!response.ok) throw new Error(`Caddy route update returned HTTP ${response.status}`);

      const verified = await this.readRoutes(signal);
      const finalRoute = verified.routes.find((route) => route['@id'] === intent.id);
      if (intent.present && routeHostname(finalRoute ?? {}) !== intent.hostname) {
        throw new Error('Caddy did not publish the requested route');
      }
      if (!intent.present && finalRoute) throw new Error('Caddy did not remove the requested route');
      return;
    }
    throw new Error('Caddy configuration changed concurrently; retry the route operation');
  }

  private async readRoutes(signal: AbortSignal): Promise<{ routes: CaddyRoute[]; etag: string }> {
    const response = await this.fetch(ROUTES_PATH, {
      headers: { accept: 'application/json' },
    }, signal);
    if (!response.ok) throw new Error(`Caddy adapter readiness returned HTTP ${response.status}`);
    const etag = response.headers.get('etag');
    if (!etag) throw new Error('Caddy adapter did not provide a configuration ETag');
    const document: unknown = await response.json();
    if (
      !Array.isArray(document)
      || document.length > MAX_ROUTE_COUNT
      || document.some((route) => !route || typeof route !== 'object' || Array.isArray(route))
    ) {
      throw new Error('Caddy adapter returned an invalid route document');
    }
    return { routes: document as CaddyRoute[], etag };
  }

  private async fetch(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    const origin = await this.privateOrigin();
    return this.request(new URL(path, origin), {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
  }

  private async privateOrigin(): Promise<URL> {
    if (this.origin) return this.origin;
    if (!this.adminUrl) throw new Error('Caddy adapter is not configured on this Agent');
    let url: URL;
    try {
      url = new URL(this.adminUrl);
    } catch {
      throw new Error('Caddy adapter URL is invalid');
    }
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || (url.pathname !== '/' && url.pathname !== '')
      || url.search
      || url.hash
    ) {
      throw new Error('Caddy adapter URL must be a private HTTP(S) origin');
    }
    const addresses = await this.resolve(url.hostname);
    if (!addresses.length || addresses.some(({ address }) => !privateAddress(address))) {
      throw new Error('Caddy adapter must resolve only to private target addresses');
    }
    this.origin = url;
    return url;
  }
}
