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

Restart the Linux host, not only the container:

```sh
sudo reboot
```

After reconnecting, Docker and the Agent must recover without running the
installer again:

```sh
sudo systemctl is-active docker
sudo docker inspect initpad-agent --format 'running={{.State.Running}} health={{.State.Health.Status}}'
sudo docker exec initpad-agent node /app/dist/cli.js once
```

InitPad must show the same target identity online. A reboot must not issue a new
enrollment or increment the Agent credential generation.

## 3. Workload preservation while disconnected

Deploy a disposable project to this target and record the workload container
ID. Stop only the Agent:

```sh
workload_id=$(sudo docker ps \
  --filter label=com.initpad.managed=true \
  --format '{{.ID}}' | head -1)
test -n "$workload_id"
sudo docker stop initpad-agent
sudo docker inspect "$workload_id" --format 'running={{.State.Running}}'
```

The workload must remain running. A new deployment requested while the Agent is
offline remains queued and must not execute locally. Restore the Agent:

```sh
sudo docker start initpad-agent
sudo docker exec initpad-agent node /app/dist/cli.js once
```

The queued operation must complete exactly once and the original target must
return online.

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

## Acceptance result

The release passes only when sections 1–4 pass on a clean host. Record section 5
as pending until a genuine next release exists; close it during that release's
acceptance. Any manual repair, new enrollment, lost workload or mutable image
reference is a failure and must be documented rather than worked around.
