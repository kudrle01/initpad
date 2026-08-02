import { publicHttpsUrlIssue, withCurrentPublicHost } from './public-url';

describe('publicHttpsUrlIssue', () => {
  it.each([
    '',
    'http://initpad.example',
    'https://localhost:8080',
    'https://127.0.0.1',
    'https://192.168.1.10',
    'https://10.0.0.4',
    'https://172.20.0.2',
    'https://api.internal',
    'not a url',
  ])('rejects a callback GitHub-hosted runners cannot safely use: %s', (url) => {
    expect(publicHttpsUrlIssue(url)).not.toBeNull();
  });

  it('accepts a public HTTPS endpoint', () => {
    expect(publicHttpsUrlIssue('https://initpad.example')).toBeNull();
  });
});

describe('withCurrentPublicHost', () => {
  it('keeps the allocated port and path while replacing a stale VM address', () => {
    expect(withCurrentPublicHost(
      'http://198.51.100.20:49173/health',
      '203.0.113.10',
    )).toBe('http://203.0.113.10:49173/health');
  });

  it('preserves a URL without an explicit trailing slash', () => {
    expect(withCurrentPublicHost('http://old.test:8085', 'initpad.home.arpa'))
      .toBe('http://initpad.home.arpa:8085');
  });

  it('formats an IPv6 public host without losing the allocated port', () => {
    expect(withCurrentPublicHost('http://old.test:8085', '[2001:db8::10]'))
      .toBe('http://[2001:db8::10]:8085');
  });
});
