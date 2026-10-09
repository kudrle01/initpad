import type { NextFunction, Request, Response } from 'express';
import { readSessionToken } from '../auth/session-cookie';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FOREIGN_FETCH_SITES = new Set(['cross-site', 'same-site']);

type CsrfRequest = Pick<Request, 'method' | 'headers'> & { cookies?: unknown };

function header(request: CsrfRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A request authenticated by the session cookie may change state only if a
 * browser would have needed a CORS preflight to send it from another origin.
 * `application/json` is not a simple content type and CORS admits only the
 * InitPad origin. SameSite=Lax alone is not enough: applications deployed on
 * the same host or a sibling subdomain belong to the same site and their
 * forms would carry the cookie. Requests without the session cookie (CI,
 * Agent, webhooks, OIDC clients) hold no ambient authority (ADR-137).
 */
export function csrfRejection(request: CsrfRequest): string | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  if (!readSessionToken(request)) return null;
  const fetchSite = header(request, 'sec-fetch-site')?.toLowerCase();
  if (fetchSite && FOREIGN_FETCH_SITES.has(fetchSite)) {
    return 'Request from another site was blocked';
  }
  const contentType = (header(request, 'content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return 'Signed-in requests that change data must use application/json';
  }
  return null;
}

export function csrfProtection(request: Request, response: Response, next: NextFunction): void {
  const reason = csrfRejection(request);
  if (!reason) {
    next();
    return;
  }
  response.status(403).json({ statusCode: 403, error: 'Forbidden', message: reason });
}
