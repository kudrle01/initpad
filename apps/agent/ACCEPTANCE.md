# InitPad Agent release acceptance

Run this acceptance on a separate, disposable Linux Docker host before an
Agent release is approved for production. Do not use the control-plane host:
the test must prove that a server with no source checkout or registry login can
install the public release.

Record the host OS, CPU architecture, Docker version, release version, immutable
image digest and the result of every checkpoint. Never include the enrollment
token or `/var/lib/initpad-agent/agent.json` in the report.

## Prerequisites

- Linux with a running Docker Engine and `curl` plus `sha256sum`;
- outbound access to the InitPad control plane and `ghcr.io`;
- a control plane configured with `INITPAD_AGENT_IMAGE` and
  `INITPAD_AGENT_RELEASE_VERSION` from the signed release manifest;
- a new **Docker (InitPad Agent)** target whose public application URL is
  reachable from the intended users.

The host must not already contain an Agent identity:

```sh
sudo test ! -e /var/lib/initpad-agent
! sudo docker container inspect initpad-agent >/dev/null 2>&1
```

Use a new disposable target if either check fails. Do not remove an existing
identity merely to make this precondition pass.

## 1. First installation

In **Servers**, open the target, choose **Manage Agent**, generate the one-time
enrollment token and keep the dialog open. Copy its complete **Run on the Docker
server** command to the Linux host. The command downloads the installer from
the control plane, verifies its signed-release SHA-256 and passes an immutable
image digest. Paste the enrollment token only into the hidden prompt.

HTTP is accepted only when the control plane itself generated the explicit
`--allow-insecure-http` flag for a trusted LAN test. Internet-facing acceptance
requires HTTPS.

On the host, verify the installed state without printing the credential:

```sh
sudo docker inspect initpad-agent \
  --format 'image={{.Config.Image}} restart={{.HostConfig.RestartPolicy.Name}} readonly={{.HostConfig.ReadonlyRootfs}}'
sudo docker exec initpad-agent node /app/dist/cli.js version
sudo docker exec initpad-agent node /app/dist/cli.js once
sudo stat -c 'identity-mode=%a owner=%u:%g' /var/lib/initpad-agent/agent.json
```

Expected results are the release digest, `unless-stopped`, `true`, the declared
Agent version, an accepted heartbeat and identity mode `600`. The target must
become **online** in InitPad. Run **Test protocol** and **Test Docker**; both
jobs must succeed.

## 2. Reboot recovery

Use the verified `initpad-agent-host-acceptance.sh` asset from the same release
to check the Docker boot service, Agent restart policy, identity, container and
any existing workloads before restarting the Linux host:

```sh
sudo ./initpad-agent-host-acceptance.sh before-reboot
sudo reboot
```

Do not run the installer or create another enrollment after reconnecting. The
same Agent must recover automatically:

```sh
sudo ./initpad-agent-host-acceptance.sh after-reboot
```

InitPad must show the same target identity online. A reboot must not issue a new
enrollment or increment the Agent credential generation. On a conventional
systemd host, `before-reboot` fails early when `docker.service` is not enabled.
The installer reports the same condition but deliberately does not change host
boot policy without an operator decision.

If an existing installation is already offline after a reboot, diagnose and
recover it without re-enrollment:

```sh
sudo systemctl is-enabled docker
sudo systemctl is-active docker
sudo docker inspect initpad-agent \
  --format 'running={{.State.Running}} restart={{.HostConfig.RestartPolicy.Name}} exit={{.State.ExitCode}}'
sudo docker logs --tail=100 initpad-agent
sudo systemctl enable --now docker  # only when the service was disabled/inactive
sudo docker start initpad-agent     # only when Docker is active and the container is stopped
```

`unless-stopped` is intentional: a running Agent recovers after reboot, while
an Agent that an administrator explicitly stopped remains stopped. Starting an
existing container preserves its target identity; generating a new token is
not a recovery step.

## 3. Workload preservation while disconnected

Deploy a disposable project to this target and record the workload container
ID. Download `initpad-agent-host-acceptance.sh` with its checksum and Sigstore
bundle from the same tagged Agent release and verify them as described in
`RELEASING.md`. The helper records only non-secret target/container identifiers
in a root-only local report and never stops or starts anything itself:

```sh
sudo ./initpad-agent-host-acceptance.sh before-disconnect
sudo docker stop initpad-agent
sudo ./initpad-agent-host-acceptance.sh disconnected
```

The workload must remain running. Request **Test protocol** while the Agent is
offline; the job must remain queued and must not execute locally. Restore the
Agent:

```sh
sudo docker start initpad-agent
sudo ./initpad-agent-host-acceptance.sh after-reconnect
sudo cat /var/lib/initpad-agent/acceptance/results.tsv
```

The queued protocol test must complete exactly once and the original target
must return online. The report must contain `before-disconnect`, `disconnected`
and `after-reconnect` PASS rows. The helper also proves that the target
identity, credential generation, Agent container and every existing workload
container were preserved.

## 4. Idempotent reinstall and failed-update rollback

Run the same installer command from step 1 again with the same release digest.
It must retain `/var/lib/initpad-agent/agent.json`, replace the Agent container
and reconnect without another token. The target ID and workload container ID
must remain unchanged.

Then exercise automatic rollback with this deliberately incompatible,
digest-pinned image. Reuse the verified installer already downloaded in step 1
and the same control-plane URL; add `--allow-insecure-http` only for the trusted
LAN setup that used it originally.

```sh
sudo sh ./initpad-agent-install.sh \
  --url 'https://CONTROL_PLANE' \
  --image 'nginx@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa'
```

The command must fail because the replacement cannot send an Agent heartbeat.
The installer must remove that container, restore the previous Agent and leave
the workload running:

```sh
sudo docker exec initpad-agent node /app/dist/cli.js version
sudo docker exec initpad-agent node /app/dist/cli.js once
sudo docker inspect "$workload_id" --format 'running={{.State.Running}}'
! sudo docker container inspect initpad-agent-previous >/dev/null 2>&1
```

The version must still be the accepted release, the heartbeat must pass, the
workload must be running and no parked `initpad-agent-previous` container may
remain.

For Agent 0.14.3 or newer, also expose the same disposable control plane
through a second trusted URL and rerun the generated installer command from
that URL. The command must print a verified URL migration, preserve the target
ID and credential generation, and reconnect without an enrollment token.
Temporarily make the candidate URL unreachable and repeat with a third URL;
the installer must fail while the previously verified URL and running Agent
remain unchanged. Never point this test at another InitPad database: changing
instances is re-enrollment, not URL migration.

## 5. Real release update

A real update requires a second signed release with a different immutable
digest. Do not move a tag, retag the old image or substitute a locally built
image to claim this checkpoint.

After the next Agent version is published, configure its manifest pair on the
control plane and copy the newly generated installer command. Running it on the
same host must preserve the identity and workloads, report the new version and
remove the previous Agent container only after the first new heartbeat succeeds.

Before stopping the old container, the installer must verify the saved identity
with the candidate image. Test a revoked credential separately: the default
update must stop without changing either container or config and must instruct
the operator to issue a fresh enrollment and use `--re-enroll`. That explicit
path must redeem a new token, replace the identity and return the target online;
it is recovery evidence, not a successful identity-preserving upgrade.

Agent 0.13 introduced the remote-update protocol in source, but the published
0.13.0 image and candidate 0.14.0 both omitted the production `sigstore`
dependency. They are runtime-revoked and must not be used as the working side
of this test. Their candidate preflight failure is valid rejection evidence:
the installer stopped before replacing the existing Agent.

Corrected release 0.14.1 is public, signed and passed its final-image runtime
probe and anonymous distribution audit. Release 0.14.2 is also public, signed,
runtime-probed and anonymously audited. To reproduce the accepted transition,
keep 0.14.1 installed on the disposable target, open **Manage Agent**, review
0.14.2 and choose
**Install update**. Do not use `--re-enroll`: retaining the same target identity
is part of this test. Confirm all of the following:

- one `agent-update` job advances through signature verification, immutable
  pull, candidate preflight and heartbeat verification;
- the target briefly reconnects with the new version while application
  workloads and their container IDs stay unchanged;
- the audit log contains accepted and terminal Agent update events without a
  manifest, credential or runtime log;
- a candidate that cannot heartbeat produces `agent_update_rolled_back`, the
  old version returns online and no `initpad-agent-previous` container remains;
- a second target is updated only after the first target passes **Test
  protocol** and **Test Docker**. No fleet-wide automatic rollout occurs.

Use the signed host helper to capture reproducible evidence. First run
`before-update 0.14.1`. For the rollback pass, run `inject-failure` in a second
terminal before choosing **Install update**, then verify the failed operation
with `after-rollback 0.14.1`. The fault injector waits for a different running
`initpad-agent` container and pauses only that replacement; it does not alter
the release, identity, control plane or application workload. Repeat
`before-update 0.14.1`, install the update without fault injection and finish
with `after-update 0.14.2`.

## Acceptance result

Sections 1–4 and the real `0.14.1 → 0.14.2` transition in section 5 passed on
separate Linux hosts by 21 September 2026. A fault-injected replacement failed
closed and restored 0.14.1; the subsequent clean update preserved the target
identity and application workloads and connected as 0.14.2. Releases 0.13.0
and 0.14.0 remain documented runtime rejections rather than accepted baselines.
Any future manual repair, new enrollment, lost workload or mutable image
reference is a failure and must be documented rather than worked around.
