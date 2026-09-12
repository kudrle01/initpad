import { lookup } from 'node:dns/promises';
import http from 'node:http';

const ROUTES_PATH = '/config/apps/http/servers/initpad/routes';
const MAX_ROUTE_COUNT = 10_000;
const MAX_RECONCILE_ATTEMPTS = 5;
const MAX_ADMIN_RESPONSE_BYTES = 1024 * 1024;
const ADMIN_SOCKET = /^\/(?:var\/)?run\/[A-Za-z0-9._/-]+\.sock$/;

type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
type CaddyRoute = Record<string, unknown>;
type UnixRequest = (
  socketPath: string,
  path: string,
  init: RequestInit,
  signal: AbortSignal,
) => Promise<Response>;

export interface CaddyRouteIntent {
  id: string;
  hostname: string;
  upstream: string;
  present: boolean;
}

export interface CaddyRouteSnapshot {
  upstream: string;
}

function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd'))
    return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const octets = normalized.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function routeHostname(route: CaddyRoute): string | null {
  const match = route.match;
  if (!Array.isArray(match) || match.length !== 1) return null;
  const matcher: unknown = match[0];
  if (!matcher || typeof matcher !== 'object' || Array.isArray(matcher)) return null;
  const hosts = (matcher as Record<string, unknown>).host;
  return Array.isArray(hosts) && hosts.length === 1 && typeof hosts[0] === 'string'
    ? hosts[0]
    : null;
}

function routeUpstream(route: CaddyRoute): string | null {
  if (route.terminal !== true || !Array.isArray(route.handle) || route.handle.length !== 1)
    return null;
  const handler: unknown = route.handle[0];
  if (!handler || typeof handler !== 'object' || Array.isArray(handler)) return null;
  const record = handler as Record<string, unknown>;
  if (
    record.handler !== 'reverse_proxy' ||
    !Array.isArray(record.upstreams) ||
    record.upstreams.length !== 1
  ) {
    return null;
  }
  const upstream: unknown = record.upstreams[0];
  if (!upstream || typeof upstream !== 'object' || Array.isArray(upstream)) return null;
  const dial = (upstream as Record<string, unknown>).dial;
  return typeof dial === 'string' ? dial : null;
}

function managedRoute(intent: CaddyRouteIntent): CaddyRoute {
  return {
    '@id': intent.id,
    match: [{ host: [intent.hostname] }],
    handle: [
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial: intent.upstream }],
      },
    ],
    terminal: true,
  };
}

export class CaddyAdminClient {
  private origin?: URL;
  private socket?: string;

  constructor(
    private readonly adminUrl = process.env.INITPAD_AGENT_GATEWAY_ADMIN_URL ?? '',
    private readonly resolve: Resolver = (hostname) => lookup(hostname, { all: true }),
    private readonly request: typeof fetch = fetch,
    private readonly adminSocket = process.env.INITPAD_AGENT_GATEWAY_ADMIN_SOCKET ?? '',
    private readonly unixRequest?: UnixRequest,
  ) {}

  async ready(signal: AbortSignal): Promise<void> {
    await this.readRoutes(signal);
  }

  async currentRoute(
    id: string,
    hostname: string,
    signal: AbortSignal,
  ): Promise<CaddyRouteSnapshot | null> {
    const current = await this.readRoutes(signal);
    const owned = current.routes.filter((route) => route['@id'] === id);
    if (owned.length > 1) throw new Error('Caddy contains duplicate InitPad route identities');
    if (!owned.length) return null;
    if (routeHostname(owned[0]) !== hostname) {
      throw new Error('Caddy route identity is already bound to another hostname');
    }
    const upstream = routeUpstream(owned[0]);
    if (!upstream) throw new Error('Caddy owned route has an invalid upstream');
    return { upstream };
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
        intent.present &&
        ownedRoutes.length === 1 &&
        routeHostname(ownedRoutes[0]) === intent.hostname &&
        routeUpstream(ownedRoutes[0]) === intent.upstream
      )
        return;
      if (!intent.present && ownedRoutes.length === 0) return;

      const next = current.routes.filter((route) => route['@id'] !== intent.id);
      if (intent.present) next.push(managedRoute(intent));

      const response = await this.fetch(
        ROUTES_PATH,
        {
          method: 'PATCH',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'if-match': current.etag,
          },
          body: JSON.stringify(next),
        },
        signal,
      );
      if (response.status === 412) continue;
      if (!response.ok) throw new Error(`Caddy route update returned HTTP ${response.status}`);

      const verified = await this.readRoutes(signal);
      const finalRoute = verified.routes.find((route) => route['@id'] === intent.id);
      if (intent.present && routeHostname(finalRoute ?? {}) !== intent.hostname) {
        throw new Error('Caddy did not publish the requested route');
      }
      if (!intent.present && finalRoute)
        throw new Error('Caddy did not remove the requested route');
      return;
    }
    throw new Error('Caddy configuration changed concurrently; retry the route operation');
  }

  private async readRoutes(signal: AbortSignal): Promise<{ routes: CaddyRoute[]; etag: string }> {
    const response = await this.fetch(
      ROUTES_PATH,
      {
        headers: { accept: 'application/json' },
      },
      signal,
    );
    if (!response.ok) throw new Error(`Caddy adapter readiness returned HTTP ${response.status}`);
    const etag = response.headers.get('etag');
    if (!etag) throw new Error('Caddy adapter did not provide a configuration ETag');
    const document: unknown = await response.json();
    if (
      !Array.isArray(document) ||
      document.length > MAX_ROUTE_COUNT ||
      document.some((route) => !route || typeof route !== 'object' || Array.isArray(route))
    ) {
      throw new Error('Caddy adapter returned an invalid route document');
    }
    return { routes: document as CaddyRoute[], etag };
  }

  private async fetch(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    const socket = this.privateSocket();
    if (socket) {
      return this.unixRequest
        ? this.unixRequest(socket, path, init, signal)
        : this.fetchSocket(socket, path, init, signal);
    }
    const origin = await this.privateOrigin();
    return this.request(new URL(path, origin), {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
  }

  private privateSocket(): string | null {
    if (this.socket) return this.socket;
    const socket = this.adminSocket.trim();
    if (!socket) return null;
    if (this.adminUrl.trim()) {
      throw new Error('Configure either the Caddy admin Unix socket or URL, not both');
    }
    if (!ADMIN_SOCKET.test(socket) || socket.includes('/../') || socket.includes('//')) {
      throw new Error('Caddy adapter socket must be a bounded path below /run');
    }
    this.socket = socket;
    return socket;
  }

  private fetchSocket(
    socketPath: string,
    path: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    if (init.body !== undefined && typeof init.body !== 'string') {
      throw new Error('Caddy adapter Unix request body is invalid');
    }
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath,
          path,
          method: init.method ?? 'GET',
          headers: { host: 'localhost', ...headers },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_ADMIN_RESPONSE_BYTES) {
              request.destroy(new Error('Caddy adapter response is too large'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(response.headers)) {
              if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
              else if (value !== undefined) responseHeaders.set(name, value);
            }
            resolve(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode ?? 500,
                headers: responseHeaders,
              }),
            );
          });
        },
      );
      const abort = () => request.destroy(new Error('Caddy adapter request aborted'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      request.setTimeout(10_000, () =>
        request.destroy(new Error('Caddy adapter request timed out')),
      );
      request.on('error', reject);
      request.on('close', () => signal.removeEventListener('abort', abort));
      if (typeof init.body === 'string') request.write(init.body);
      request.end();
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
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
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
