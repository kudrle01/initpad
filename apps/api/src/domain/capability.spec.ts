import { targetCanRun, templateRuntime } from './capability';
import type { ArtifactKind, ProviderKind, RuntimeKind } from './types';

describe('templateRuntime', () => {
  it('uses the explicit runtime when present', () => {
    expect(templateRuntime({ runtime: 'php', artifact: 'runtime' })).toBe('php');
  });
  it("defaults static artifacts to 'static'", () => {
    expect(templateRuntime({ artifact: 'static' })).toBe('static');
  });
  it("defaults non-static artifacts to 'node'", () => {
    expect(templateRuntime({ artifact: 'runtime' })).toBe('node');
  });
});

describe('targetCanRun', () => {
  const nette: {
    compatibleProviders: ProviderKind[];
    runtime: RuntimeKind;
    artifact: ArtifactKind;
  } = {
    compatibleProviders: ['docker', 'sftp'],
    runtime: 'php',
    artifact: 'runtime',
  };

  it('accepts a PHP-capable SFTP host', () => {
    expect(targetCanRun(nette, { kind: 'sftp', capabilities: ['static', 'php'] })).toBe(true);
  });
  it('rejects a static-only SFTP host for a PHP app', () => {
    expect(targetCanRun(nette, { kind: 'sftp', capabilities: ['static'] })).toBe(false);
  });
  it('rejects a target kind the template does not accept', () => {
    expect(targetCanRun(nette, { kind: 'ssh', capabilities: ['php'] })).toBe(false);
  });
  it('accepts Docker (runs anything) for a PHP app', () => {
    expect(
      targetCanRun(nette, { kind: 'docker', capabilities: ['static', 'node', 'php', 'python'] }),
    ).toBe(true);
  });
});
