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
  // A linear scan instead of /\/+$/, which backtracks quadratically on a long
  // run of slashes that is not at the end of the string.
  let end = base.length;
  while (end > 0 && base[end - 1] === '/') end -= 1;
  const trimmed = base.slice(0, end);
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
