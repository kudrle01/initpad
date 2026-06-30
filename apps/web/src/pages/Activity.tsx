import { ComingSoon } from '@/components/ComingSoon';

export default function Activity() {
  return (
    <ComingSoon icon="activity" title="Activity">
      A timeline of deployments and CI runs across all projects — who deployed
      what, when, to which environment, and whether the pipeline passed. A useful
      audit trail for the platform.
    </ComingSoon>
  );
}
