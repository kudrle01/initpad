import { readFileSync } from 'fs';
import { join } from 'path';
import { csrfProtection, csrfRejection } from './csrf-protection';

const session = { initpad_token: 'jwt' };

function request(
  method: string,
  headers: Record<string, string> = {},
  cookies: Record<string, string> = session,
) {
  return { method, headers, cookies };
}

describe('CSRF protection (ADR-137)', () => {
  it('blocks a same-site form post that carries the session cookie', () => {
    // A deployed application on another port of the same host posts a form.
    expect(
      csrfRejection(
        request('POST', {
          'content-type': 'application/x-www-form-urlencoded',
          'sec-fetch-site': 'same-site',
        }),
      ),
    ).toBe('Request from another site was blocked');
    // Browsers without Fetch Metadata are stopped by the content type.
    expect(csrfRejection(request('POST', { 'content-type': 'text/plain;charset=UTF-8' }))).toBe(
      'Signed-in requests that change data must use application/json',
    );
    expect(csrfRejection(request('DELETE'))).not.toBeNull();
  });

  it('allows the InitPad web client', () => {
    expect(
      csrfRejection(
        request('POST', {
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toBeNull();
    expect(
      csrfRejection(request('PUT', { 'content-type': 'Application/JSON; charset=utf-8' })),
    ).toBeNull();
  });

  it('ignores reads and requests without the session cookie', () => {
    expect(csrfRejection(request('GET', { 'sec-fetch-site': 'cross-site' }))).toBeNull();
    // Gitea's OIDC token request and CI or Agent callbacks hold no session.
    expect(
      csrfRejection(request('POST', { 'content-type': 'application/x-www-form-urlencoded' }, {})),
    ).toBeNull();
  });

  it('answers a blocked request with 403 and does not reach the route', () => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const next = jest.fn();
    csrfProtection(
      request('POST', { 'content-type': 'text/plain' }) as never,
      response as never,
      next,
    );
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('is installed after cookie parsing in the API bootstrap', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(main.indexOf('app.use(csrfProtection)')).toBeGreaterThan(
      main.indexOf('app.use(cookieParser())'),
    );
  });
});
