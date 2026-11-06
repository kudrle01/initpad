import type { AgentDistribution } from '@/types';

/** Where the generated command stores the CA for the Agent process (--ca-file). */
export const AGENT_PRIVATE_CA_FILE = '/etc/initpad-agent/ca.crt';

type CommandDistribution = Pick<AgentDistribution, 'installer' | 'privateCa'>;

export interface AgentInstallCommandInput {
  /** Browser origin of the control plane, e.g. https://initpad.lab.example */
  origin: string;
  distribution: CommandDistribution;
  image: string;
  targetId: string;
}

export interface AgentUninstallCommandInput {
  origin: string;
  distribution: CommandDistribution;
  targetId: string;
  /** Also remove the containers and networks InitPad deployed for the target. */
  removeWorkloads: boolean;
}

/**
 * Downloads the reviewed installer and accepts it only with the checksum
 * shown in Manage Agent.
 *
 * With an internal CA (ADR-161) a Docker server may not be able to verify the
 * control plane's HTTPS. The CA is then fetched over plain HTTP and accepted
 * only when its SHA-256 matches the value the administrator's browser
 * received over verified HTTPS.
 */
function downloadSteps(
  url: URL,
  distribution: CommandDistribution,
  installCa: boolean,
): { steps: string[]; caOption: string } {
  const installerUrl = new URL(distribution.installer.path, url).toString();
  const privateCa = url.protocol === 'http:' ? null : distribution.privateCa;
  const steps: string[] = [];
  let installerCurl = 'curl -fsSLo';
  let caOption = '';
  if (privateCa) {
    const caUrl = new URL(privateCa.path, `http://${url.hostname}`).toString();
    steps.push(
      `curl -fsSo initpad-ca.crt '${caUrl}'`,
      `printf '%s  %s\\n' '${privateCa.sha256}' initpad-ca.crt | sha256sum -c -`,
    );
    if (installCa) {
      const dockerCa = `/etc/docker/certs.d/${privateCa.registryHost}/ca.crt`;
      steps.push(
        `sudo install -D -m 644 initpad-ca.crt '${dockerCa}'`,
        `sudo install -D -m 644 initpad-ca.crt '${AGENT_PRIVATE_CA_FILE}'`,
      );
      caOption = ` --ca-file '${AGENT_PRIVATE_CA_FILE}'`;
    }
    installerCurl = 'curl --cacert initpad-ca.crt -fsSLo';
  }
  steps.push(
    `${installerCurl} initpad-agent-install.sh '${installerUrl}'`,
    `printf '%s  %s\\n' '${distribution.installer.sha256}' initpad-agent-install.sh | sha256sum -c -`,
  );
  return { steps, caOption };
}

/**
 * Builds the one-line, checksum-verified installation command shown in
 * Manage Agent. With an internal CA it also trusts the CA for the registry in
 * Docker and passes it to the Agent, without changing the server's
 * system-wide trust store.
 */
export function buildAgentInstallCommand({
  origin,
  distribution,
  image,
  targetId,
}: AgentInstallCommandInput): string {
  const url = new URL(origin);
  const insecureHttp = url.protocol === 'http:';
  const { steps, caOption } = downloadSteps(url, distribution, true);
  steps.push(
    `sudo sh ./initpad-agent-install.sh --url '${url.origin}' --image '${image}' --expected-target-id '${targetId}'${caOption}${insecureHttp ? ' --allow-insecure-http' : ''}`,
  );
  return steps.join(' && ');
}

/**
 * Builds the uninstall command: the same verified installer in --uninstall
 * mode, bound to this target so it refuses a server enrolled elsewhere. The
 * script lists what it removes and asks for confirmation.
 */
export function buildAgentUninstallCommand({
  origin,
  distribution,
  targetId,
  removeWorkloads,
}: AgentUninstallCommandInput): string {
  const { steps } = downloadSteps(new URL(origin), distribution, false);
  steps.push(
    `sudo sh ./initpad-agent-install.sh --uninstall --expected-target-id '${targetId}'${removeWorkloads ? ' --remove-workloads' : ''}`,
  );
  return steps.join(' && ');
}
