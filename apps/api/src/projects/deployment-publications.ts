/** Deployment operations which successfully published an immutable application version. */
export const DEPLOYMENT_PUBLICATION_KINDS = [
  'ci-deploy',
  'promote',
  'redeploy',
  'retry',
  'artifact-recovery',
  'rollback',
] as const;
