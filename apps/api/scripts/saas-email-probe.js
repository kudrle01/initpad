/* eslint-disable no-console */
const { randomBytes } = require('node:crypto');
const nodemailer = require('nodemailer');

function requiredEnvironment(name) {
  const value = (process.env[name] || '').trim();
  if (!value || /[\r\n\0]/.test(value)) throw new Error(`${name} is required`);
  return value;
}

function parseBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw !== 'true' && raw !== 'false') throw new Error(`${name} must be true or false`);
  return raw === 'true';
}

async function main() {
  const port = Number(process.env.INITPAD_SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('INITPAD_SMTP_PORT is invalid');
  }
  const host = requiredEnvironment('INITPAD_SMTP_HOST');
  const username = requiredEnvironment('INITPAD_SMTP_USERNAME');
  const password = requiredEnvironment('INITPAD_SMTP_PASSWORD');
  const from = requiredEnvironment('INITPAD_SMTP_FROM');
  const recipient = requiredEnvironment('INITPAD_SMTP_ACCEPTANCE_RECIPIENT');
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: parseBoolean('INITPAD_SMTP_SECURE', false),
    requireTLS: parseBoolean('INITPAD_SMTP_REQUIRE_TLS', true),
    auth: { user: username, pass: password },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transporter.verify();
    await transporter.sendMail({
      from,
      to: recipient,
      subject: 'InitPad staging e-mail acceptance',
      text: 'InitPad connected to the configured SMTP relay and submitted this staging acceptance message.',
      messageId: `<acceptance-${randomBytes(16).toString('hex')}@${host}>`,
    });
  } finally {
    transporter.close();
  }
  console.log('SMTP authentication and test delivery were accepted.');
}

main().catch(() => {
  console.error('SMTP acceptance failed. Check the provider configuration without sharing secrets.');
  process.exit(1);
});
