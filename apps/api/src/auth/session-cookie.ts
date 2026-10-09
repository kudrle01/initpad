import type { Response } from 'express';
import { config } from '../config';
import { readStringCookie } from '../common/request-cookie';

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PLAIN_SESSION_COOKIE = 'initpad_token';
// Under HTTPS the session cookie uses the __Host- prefix. Browsers then accept
// it only from this exact host with Secure and Path=/, so an application on a
// sibling subdomain cannot plant or overwrite an InitPad session (ADR-137).
// The unprefixed name is never trusted there: a planted cookie could carry it.
const HOST_SESSION_COOKIE = '__Host-initpad_token';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.auth.secureCookie,
    path: '/',
  };
}

export function sessionCookieName(): string {
  return config.auth.secureCookie ? HOST_SESSION_COOKIE : PLAIN_SESSION_COOKIE;
}

export function readSessionToken(request: { cookies?: unknown }): string | undefined {
  return readStringCookie(request, sessionCookieName());
}

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(sessionCookieName(), token, {
    ...cookieOptions(),
    maxAge: SESSION_MAX_AGE_MS,
  });
  // A session issued before the prefix was introduced is no longer read.
  if (config.auth.secureCookie) response.clearCookie(PLAIN_SESSION_COOKIE, cookieOptions());
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(sessionCookieName(), cookieOptions());
  if (config.auth.secureCookie) response.clearCookie(PLAIN_SESSION_COOKIE, cookieOptions());
}
