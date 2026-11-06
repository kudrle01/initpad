import { describe, expect, it } from 'vitest';
import {
  AGENT_PRIVATE_CA_FILE,
  buildAgentInstallCommand,
  buildAgentUninstallCommand,
  gatewayDomainOf,
} from './agent-install-command';

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
    expect(steps[steps.length - 1]).toMatch(/ --ca-file '\/etc\/initpad-agent\/ca\.crt'$/);
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

describe('buildAgentUninstallCommand', () => {
  it('runs the verified installer in uninstall mode bound to the target', () => {
    expect(
      buildAgentUninstallCommand({
        origin: 'https://platform.example.org',
        distribution: { installer, privateCa: null },
        targetId: 't1',
        removeWorkloads: false,
      }),
    ).toBe(
      `curl -fsSLo initpad-agent-install.sh 'https://platform.example.org/api/agent/distribution/install.sh' && ` +
        `printf '%s  %s\\n' '${'a'.repeat(64)}' initpad-agent-install.sh | sha256sum -c - && ` +
        `sudo sh ./initpad-agent-install.sh --uninstall --expected-target-id 't1'`,
    );
  });

  it('removes workloads only when asked', () => {
    const command = buildAgentUninstallCommand({
      origin: 'https://platform.example.org',
      distribution: { installer, privateCa: null },
      targetId: 't1',
      removeWorkloads: true,
    });

    expect(command).toMatch(/ --uninstall --expected-target-id 't1' --remove-workloads$/);
  });

  it('verifies the internal CA for the download but does not install it again', () => {
    const command = buildAgentUninstallCommand({
      origin: 'https://initpad.lab.example',
      distribution: { installer, privateCa },
      targetId: 't1',
      removeWorkloads: false,
    });

    expect(command).toContain(
      `printf '%s  %s\\n' '${'c'.repeat(64)}' initpad-ca.crt | sha256sum -c -`,
    );
    expect(command).toContain('curl --cacert initpad-ca.crt -fsSLo initpad-agent-install.sh');
    expect(command).not.toMatch(/sudo install|--ca-file|--image|--url/);
  });
});

describe('managed gateway in the install command', () => {
  const base = {
    origin: 'https://platform.example.org',
    distribution: { installer, privateCa: null },
    image,
    targetId: 't1',
  };

  it('adds the gateway domain so one command sets up the gateway', () => {
    const command = buildAgentInstallCommand({ ...base, gatewayDomain: 'apps.lab.example' });
    expect(command).toMatch(/--expected-target-id 't1' --gateway-domain 'apps\.lab\.example'$/);
  });

  it('keeps the CA option before the gateway option so both reach the installer', () => {
    const command = buildAgentInstallCommand({
      ...base,
      origin: 'https://initpad.lab.example',
      distribution: { installer, privateCa },
      gatewayDomain: 'apps.lab.example',
    });
    expect(command).toMatch(
      /--ca-file '\/etc\/initpad-agent\/ca\.crt' --gateway-domain 'apps\.lab\.example'$/,
    );
  });

  it('never puts a value that is not a plain DNS name into the shell command', () => {
    for (const domain of [
      "x'; rm -rf /; '",
      'a b.example',
      'UPPER.example',
      '-bad.example',
      'nodots',
    ]) {
      expect(buildAgentInstallCommand({ ...base, gatewayDomain: domain })).not.toContain(
        '--gateway-domain',
      );
    }
  });

  it('derives the domain from the public URL of a gateway target', () => {
    expect(gatewayDomainOf('https://Apps.Lab.Example')).toBe('apps.lab.example');
    expect(gatewayDomainOf('https://apps.lab.example/')).toBe('apps.lab.example');
    expect(gatewayDomainOf('http://apps.lab.example')).toBeNull();
    expect(gatewayDomainOf('https://10.0.0.5')).toBeNull();
    expect(gatewayDomainOf('not a url')).toBeNull();
    expect(gatewayDomainOf(null)).toBeNull();
  });
});
