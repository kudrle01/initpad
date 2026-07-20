import { publicHttpsUrlIssue } from './public-url';

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
