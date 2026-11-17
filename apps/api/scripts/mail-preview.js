/* eslint-disable no-console */
// Renders every transactional e-mail with sample data into standalone HTML
// and text files for a quick look in a browser:
//   npm run mail:preview --workspace @initpad/api [-- <output-dir>]
// The inline logo (cid:) is swapped for a data: URI so the files open as-is.
// Real-client checks still need a send through SMTP (e.g. Mailpit).
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist', 'mail', 'templates');
const { renderAuthMail } = require(path.join(dist, 'auth-mail.js'));
const { LOGO_CID, LOGO_PNG_BASE64 } = require(path.join(dist, 'brand.js'));

const outDir = path.resolve(
  process.argv[2] || path.join(__dirname, '..', '..', '..', 'tmp', 'mail-preview'),
);
const url = 'https://initpad.example/verify-email#preview-token-0123456789abcdef';
const samples = {
  email_verify: { displayName: 'Alice Novak', url },
  password_reset: {
    displayName: 'Alice Novak',
    url: url.replace('verify-email', 'reset-password'),
  },
  activation: { displayName: null, url: url.replace('verify-email', 'activate') },
  workspace_invite: {
    displayName: null,
    url: url.replace('verify-email', 'invite'),
    workspaceName: 'Robotics Club',
    inviterName: 'Alice Novak',
    role: 'maintainer',
  },
};

fs.mkdirSync(outDir, { recursive: true });
const links = [];
for (const [kind, payload] of Object.entries(samples)) {
  const mail = renderAuthMail(kind, payload);
  const html = mail.html.replaceAll(`cid:${LOGO_CID}`, `data:image/png;base64,${LOGO_PNG_BASE64}`);
  fs.writeFileSync(path.join(outDir, `${kind}.html`), html);
  fs.writeFileSync(path.join(outDir, `${kind}.txt`), `Subject: ${mail.subject}\n\n${mail.text}`);
  links.push(
    `<li><a href="${kind}.html">${kind}</a> · <a href="${kind}.txt">text</a> — ${mail.subject}</li>`,
  );
}
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>InitPad mail previews</title><ul>${links.join('')}</ul>`,
);
console.log(`Mail previews written to ${outDir}`);
