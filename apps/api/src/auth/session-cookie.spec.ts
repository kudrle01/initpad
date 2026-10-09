import { config } from '../config';
import {
  clearSessionCookie,
  readSessionToken,
  sessionCookieName,
  setSessionCookie,
} from './session-cookie';

function response() {
  return { cookie: jest.fn(), clearCookie: jest.fn() };
}

describe('session cookie (ADR-137)', () => {
  const originalSecure = config.auth.secureCookie;
  afterEach(() => {
    config.auth.secureCookie = originalSecure;
  });

  it('uses a __Host- cookie under HTTPS and never trusts the unprefixed name', () => {
    config.auth.secureCookie = true;
    expect(sessionCookieName()).toBe('__Host-initpad_token');
    // A sibling subdomain can plant `initpad_token` for the parent domain.
    expect(readSessionToken({ cookies: { initpad_token: 'planted' } })).toBeUndefined();
    expect(readSessionToken({ cookies: { '__Host-initpad_token': 'session' } })).toBe('session');

    const res = response();
    setSessionCookie(res as never, 'jwt');
    expect(res.cookie).toHaveBeenCalledWith(
      '__Host-initpad_token',
      'jwt',
      expect.objectContaining({ httpOnly: true, secure: true, path: '/', sameSite: 'lax' }),
    );
    // __Host- forbids a Domain attribute; the options must never set one.
    expect(res.cookie.mock.calls[0][2]).not.toHaveProperty('domain');
    expect(res.clearCookie).toHaveBeenCalledWith('initpad_token', expect.any(Object));
  });

  it('keeps the plain cookie over HTTP, where __Host- cannot be set', () => {
    config.auth.secureCookie = false;
    expect(sessionCookieName()).toBe('initpad_token');
    expect(readSessionToken({ cookies: { initpad_token: 'session' } })).toBe('session');

    const res = response();
    clearSessionCookie(res as never);
    expect(res.clearCookie).toHaveBeenCalledTimes(1);
    expect(res.clearCookie).toHaveBeenCalledWith('initpad_token', expect.any(Object));
  });
});
