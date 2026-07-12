import { ProviderKind, RuntimeKind, TemplateManifest } from './types';

/**
 * Pure capability model: which deployment targets can host which templates.
 * Kept dependency-free so it is trivially unit-testable and shared by the
 * project-creation/target-binding logic.
 */

// The runtime a template needs. Defaults to 'static' for static artifacts and
// 'node' otherwise when the manifest omits it.
export function templateRuntime(t: Pick<TemplateManifest, 'runtime' | 'artifact'>): RuntimeKind {
  return t.runtime ?? (t.artifact === 'static' ? 'static' : 'node');
}

export interface TargetCapability {
  kind: ProviderKind;
  capabilities: RuntimeKind[];
}

// A target can host a template when the template accepts the target's kind AND
// the target can run the template's runtime (e.g. a static SFTP host cannot run
// PHP, but a PHP-capable SFTP host can).
export function targetCanRun(
  template: Pick<TemplateManifest, 'compatibleProviders' | 'runtime' | 'artifact'>,
  target: TargetCapability,
): boolean {
  return (
    template.compatibleProviders.includes(target.kind) &&
    target.capabilities.includes(templateRuntime(template))
  );
}
