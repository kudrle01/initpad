export type DeploymentOperationResult = 'succeeded' | 'failed' | 'cancelled';
export type ActiveDeploymentPhase = 'assigned' | 'running' | 'verifying';
export type DeploymentOperationPhase =
  | 'queued'
  | ActiveDeploymentPhase
  | DeploymentOperationResult
  | 'unhealthy';

const ACTIVE_PHASE_PREDECESSORS: Record<
  ActiveDeploymentPhase,
  DeploymentOperationPhase[]
> = {
  assigned: ['queued'],
  running: ['queued', 'assigned'],
  verifying: ['queued', 'assigned', 'running'],
};

export function activeDeploymentPhasePredecessors(
  phase: ActiveDeploymentPhase,
): DeploymentOperationPhase[] {
  return ACTIVE_PHASE_PREDECESSORS[phase];
}

export function terminalDeploymentPhase(
  status: DeploymentOperationResult,
  message?: string | null,
): DeploymentOperationPhase {
  if (status === 'failed' && /health|unhealthy/i.test(message ?? '')) return 'unhealthy';
  return status;
}
