export const MIN_LIFECYCLE_AGENT_VERSION = [0, 3, 0] as const;
export const MIN_PROJECT_AGENT_VERSION = [0, 4, 0] as const;
export const MIN_GATEWAY_AGENT_VERSION = [0, 5, 0] as const;
export const MIN_GATEWAY_ROUTE_AGENT_VERSION = [0, 7, 0] as const;

export function agentVersionAtLeast(
  version: string | null | undefined,
  minimum: readonly number[],
): boolean {
  if (!version) return false;
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index];
  }
  return true;
}

export function supportsProjectAgent(version: string | null | undefined): boolean {
  return agentVersionAtLeast(version, MIN_PROJECT_AGENT_VERSION);
}
