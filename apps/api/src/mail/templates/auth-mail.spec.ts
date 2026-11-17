import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeTtl } from '../../common/link-ttl';
import { renderAuthMail, type MailKind } from './auth-mail';
import { LOGO_CID, LOGO_PNG_BASE64 } from './brand';

const url = 'https://initpad.example/verify-email?a=1&b=2#private-token';

describe('auth mail templates', () => {
  it.each<[MailKind, string, string]>([
    ['email_verify', 'Verify your InitPad e-mail', 'expires in 24 hours'],
    ['password_reset', 'Reset your InitPad password', 'expires in 1 hour'],
    ['activation', 'Activate your InitPad account', 'expires in 3 days'],
    ['workspace_invite', 'You are invited to Robotics Club on InitPad', 'expires in 7 days'],
  ])('renders %s as a branded HTML and a plain-text body', (kind, subject, expiry) => {
    const mail = renderAuthMail(kind, {
      displayName: 'Alice',
      url,
      workspaceName: 'Robotics Club',
      inviterName: 'Bob',
      role: 'maintainer',
    });

    expect(mail.subject).toBe(subject);
    expect(mail.text).toContain(url);
    expect(mail.text).toContain(expiry);
    expect(mail.text).not.toMatch(/<[a-z]/i);
    expect(mail.html).toMatch(/^<!doctype html>/);
    expect(mail.html).toContain(`src="cid:${LOGO_CID}"`);
    expect(mail.html).toContain(
      'href="https://initpad.example/verify-email?a=1&amp;b=2#private-token"',
    );
    expect(mail.html).toContain(expiry);
  });

  it('escapes user-chosen names everywhere they appear in the HTML', () => {
    const hostile = '<img src=x onerror=alert(1)>"\'';
    const mail = renderAuthMail('workspace_invite', {
      displayName: null,
      url,
      workspaceName: hostile,
      inviterName: hostile,
      role: 'member',
    });

    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('greets by name only when one is known', () => {
    expect(renderAuthMail('activation', { displayName: 'Alice', url }).text).toMatch(
      /^Hello Alice,/,
    );
    expect(renderAuthMail('activation', { displayName: null, url }).text).toMatch(/^Hello,/);
  });

  it('embeds the same logo the web app ships', () => {
    const webLogo = readFileSync(
      join(__dirname, '../../../../web/public/brand/initpad-tile-96.png'),
    ).toString('base64');
    expect(LOGO_PNG_BASE64).toBe(webLogo);
  });
});

describe('describeTtl', () => {
  it.each([
    [60 * 60 * 1000, '1 hour'],
    [24 * 60 * 60 * 1000, '24 hours'],
    [3 * 24 * 60 * 60 * 1000, '3 days'],
  ])('describes %i ms as %s', (ms, text) => {
    expect(describeTtl(ms)).toBe(text);
  });
});
