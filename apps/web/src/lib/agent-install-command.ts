import type { AgentDistribution } from '@/types';

/** Where the generated command stores the CA for the Agent process (--ca-file). */
export const AGENT_PRIVATE_CA_FILE = '/etc/initpad-agent/ca.crt';

export interface AgentInstallCommandInput {
  /** Browser origin of the control plane, e.g. https://initpad.lab.example */
  origin: string;
  distribution: Pick<AgentDistribution, 'installer' | 'privateCa'>;
  image: string;
  targetId: string;
}

/**
 * Builds the one-line, checksum-verified installation command shown in
 * Manage Agent.
 *
 * With an internal CA (ADR-161) a new Docker server cannot verify the
 * control plane's HTTPS yet. The command therefore downloads the public root
 * certificate over plain HTTP and accepts it only when its SHA-256 matches the
 * value shown here, which the administrator's browser received over verified
 * HTTPS. It then trusts the CA for the registry in Docker, uses it for the
 * installer download and passes it to the Agent, without changing the
 * server's system-wide trust store.
 */
export function buildAgentInstallCommand({
  origin,
  distribution,
  image,
  targetId,
}: AgentInstallCommandInput): string {
  const url = new URL(origin);
  const installerUrl = new URL(distribution.installer.path, url).toString();
  const insecureHttp = url.protocol === 'http:';
  const privateCa = insecureHttp ? null : distribution.privateCa;

  const steps: string[] = [];
  let caOption = '';
  let installerCurl = 'curl -fsSLo';
  if (privateCa) {
    const caUrl = new URL(privateCa.path, `http://${url.hostname}`).toString();
    const dockerCa = `/etc/docker/certs.d/${privateCa.registryHost}/ca.crt`;
    steps.push(
      `curl -fsSo initpad-ca.crt '${caUrl}'`,
      `printf '%s  %s\\n' '${privateCa.sha256}' initpad-ca.crt | sha256sum -c -`,
      `sudo install -D -m 644 initpad-ca.crt '${dockerCa}'`,
      `sudo install -D -m 644 initpad-ca.crt '${AGENT_PRIVATE_CA_FILE}'`,
    );
    installerCurl = 'curl --cacert initpad-ca.crt -fsSLo';
    caOption = ` --ca-file '${AGENT_PRIVATE_CA_FILE}'`;
  }
  steps.push(
    `${installerCurl} initpad-agent-install.sh '${installerUrl}'`,
    `printf '%s  %s\\n' '${distribution.installer.sha256}' initpad-agent-install.sh | sha256sum -c -`,
    `sudo sh ./initpad-agent-install.sh --url '${url.origin}' --image '${image}' --expected-target-id '${targetId}'${caOption}${insecureHttp ? ' --allow-insecure-http' : ''}`,
  );
  return steps.join(' && ');
}
