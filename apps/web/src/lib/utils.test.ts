import { describe, expect, it } from 'vitest';
import { externalHref, scmLink } from './utils';

describe('external links', () => {
  it('keeps only absolute http(s) addresses', () => {
    expect(externalHref('https://ci.example.test/run/1')).toBe('https://ci.example.test/run/1');
    expect(externalHref('http://10.0.0.5:8081')).toBe('http://10.0.0.5:8081');
    for (const value of [
      'javascript:alert(document.cookie)',
      ' JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '/relative/path',
      '',
      null,
      undefined,
    ]) {
      expect(externalHref(value)).toBeUndefined();
    }
  });

  it('routes Gitea links through SSO and refuses unsafe CI status targets', () => {
    expect(scmLink('https://git.example.test/alice/app/actions/runs/3', 'gitea')).toBe(
      'https://git.example.test/user/login?redirect_to=%2Falice%2Fapp%2Factions%2Fruns%2F3',
    );
    expect(scmLink('https://github.com/alice/app', 'github')).toBe('https://github.com/alice/app');
    expect(scmLink('javascript:alert(1)', 'github')).toBeUndefined();
    expect(scmLink('javascript:alert(1)', 'gitea')).toBeUndefined();
  });
});
