import { describe, expect, it } from 'vitest';
import { AGENT_PRIVATE_CA_FILE, buildAgentInstallCommand } from './agent-install-command';

const installer = { path: '/api/agent/distribution/install.sh', sha256: 'a'.repeat(64) };
const image = `ghcr.io/example/initpad-agent@sha256:${'b'.repeat(64)}`;
const privateCa = {
  path: '/initpad-ca.crt',
  sha256: 'c'.repeat(64),
  registryHost: 'git.lab.example',
};

describe('buildAgentInstallCommand', () => {
  it('keeps the existing command for a publicly trusted control plane', () => {
    expect(
      buildAgentInstallCommand({
        origin: 'https://platform.example.org',
        distribution: { installer, privateCa: null },
        image,
        targetId: 't1',
      }),
    ).toBe(
      `curl -fsSLo initpad-agent-install.sh 'https://platform.example.org/api/agent/distribution/install.sh' && ` +
        `printf '%s  %s\\n' '${'a'.repeat(64)}' initpad-agent-install.sh | sha256sum -c - && ` +
        `sudo sh ./initpad-agent-install.sh --url 'https://platform.example.org' --image '${image}' --expected-target-id 't1'`,
    );
  });

  it('verifies and installs the internal CA before anything uses it (ADR-161)', () => {
    const command = buildAgentInstallCommand({
      origin: 'https://initpad.lab.example',
      distribution: { installer, privateCa },
      image,
      targetId: 't1',
    });
    const steps = command.split(' && ');

    expect(steps[0]).toBe(`curl -fsSo initpad-ca.crt 'http://initpad.lab.example/initpad-ca.crt'`);
    // The checksum comes from the browser's verified HTTPS session; the CA
    // fetched over HTTP is used only after it matches.
    expect(steps[1]).toBe(`printf '%s  %s\\n' '${'c'.repeat(64)}' initpad-ca.crt | sha256sum -c -`);
    expect(steps[2]).toBe(
      `sudo install -D -m 644 initpad-ca.crt '/etc/docker/certs.d/git.lab.example/ca.crt'`,
    );
    expect(steps[3]).toBe(`sudo install -D -m 644 initpad-ca.crt '${AGENT_PRIVATE_CA_FILE}'`);
    expect(steps[4]).toMatch(/^curl --cacert initpad-ca\.crt -fsSLo initpad-agent-install\.sh /);
    expect(steps.at(-1)).toMatch(/ --ca-file '\/etc\/initpad-agent\/ca\.crt'$/);
    expect(command).not.toMatch(/update-ca-certificates|--insecure|-k /);
  });

  it('downloads the CA from the default HTTP port even behind a custom HTTPS port', () => {
    const command = buildAgentInstallCommand({
      origin: 'https://initpad.lab.example:8443',
      distribution: { installer, privateCa },
      image,
      targetId: 't1',
    });

    expect(command).toContain(`'http://initpad.lab.example/initpad-ca.crt'`);
    expect(command).toContain(`--url 'https://initpad.lab.example:8443'`);
  });

  it('ignores a CA on a plain HTTP test instance and keeps the explicit opt-in', () => {
    const command = buildAgentInstallCommand({
      origin: 'http://192.168.1.10:8080',
      distribution: { installer, privateCa },
      image,
      targetId: 't1',
    });

    expect(command).not.toContain('initpad-ca.crt');
    expect(command).toMatch(/ --allow-insecure-http$/);
  });
});
