export interface AllocationTargetDefaultsInput {
  scope: string;
  remotePath: string | null;
  publicUrl: string | null;
}

export interface AllocationUsageDefaults {
  rootPath: string | null;
  publicUrl: string | null;
}

function appendPath(base: string, namespace: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed || '/'}${trimmed ? '/' : ''}${namespace}`;
}

// A new allocation of shared built-in infrastructure receives an actual
// workspace-specific path/URL prefix. User-owned targets already belong to one
// workspace, while legacy backfill must preserve byte-for-byte paths and URLs.
export function allocationUsageDefaults(
  target: AllocationTargetDefaultsInput,
  namespace: string,
  preserveLegacy = false,
): AllocationUsageDefaults {
  if (preserveLegacy || target.scope !== 'builtin') {
    return {
      rootPath: target.remotePath,
      publicUrl: target.publicUrl,
    };
  }
  return {
    rootPath: target.remotePath ? appendPath(target.remotePath, namespace) : null,
    publicUrl: target.publicUrl ? appendPath(target.publicUrl, namespace) : null,
  };
}
