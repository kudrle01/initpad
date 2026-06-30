import { ComingSoon } from '@/components/ComingSoon';

export default function Infrastructure() {
  return (
    <ComingSoon icon="network" title="Infrastructure">
      The simulated company infrastructure behind the platform: deployment
      providers (Docker, SSH, SFTP) and their targets, the isolated Docker
      networks per environment, and their health. This is where you'd see and
      manage the “where things actually run”.
    </ComingSoon>
  );
}
