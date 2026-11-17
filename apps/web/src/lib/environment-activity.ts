/**
 * The API keeps an environment `deploying` while any operation runs on it and
 * names the operation in `statusReason` (project-deployment-operations.ts).
 * Removing, stopping and starting a deployment should not read as deploying.
 */
const ACTIVITY_BY_REASON: Record<string, string> = {
  'Removing deployment': 'removing',
  'Stopping environment': 'stopping',
  'Starting environment': 'starting',
};

/** The status token to show for an environment: its own, or what is happening to it. */
export function environmentActivity(environment: {
  status: string;
  statusReason?: string | null;
}): string {
  if (environment.status !== 'deploying' || !environment.statusReason) return environment.status;
  return ACTIVITY_BY_REASON[environment.statusReason] ?? environment.status;
}
