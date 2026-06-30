import { ComingSoon } from '@/components/ComingSoon';

export default function Settings() {
  return (
    <ComingSoon icon="settings" title="Settings">
      Platform configuration: the Gitea connection and access token, the identity
      used for platform commits, and per-provider credentials (secrets). Today
      these are set through the backend's .env file.
    </ComingSoon>
  );
}
