import { config } from '../config';
import { OidcService } from './oidc.service';

describe('OidcService redirect validation', () => {
  const originalUrl = config.gitea.url;
  let service: OidcService;

  beforeAll(() => {
    config.gitea.url = 'https://git.example.test';
    service = new OidcService();
  });

  afterAll(() => {
    config.gitea.url = originalUrl;
  });

  it('accepts only a Gitea OAuth callback on the exact origin', () => {
    expect(service.isAllowedRedirect('https://git.example.test/user/oauth2/initpad/callback')).toBe(true);
    expect(service.isAllowedRedirect('https://git.example.test.evil.test/user/oauth2/initpad/callback')).toBe(false);
    expect(service.isAllowedRedirect('https://git.example.test/other/callback')).toBe(false);
    expect(service.isAllowedRedirect('https://user@git.example.test/user/oauth2/initpad/callback')).toBe(false);
  });

  it('consumes an authorization code only once', () => {
    const code = service.issueCode({
      userId: 'u1',
      tokenVersion: 0,
      clientId: 'gitea',
      redirectUri: 'https://git.example.test/user/oauth2/initpad/callback',
    });
    expect(service.consumeCode(code)?.userId).toBe('u1');
    expect(service.consumeCode(code)).toBeNull();
  });
});
