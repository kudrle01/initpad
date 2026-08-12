# InitPad Agent

InitPad Agent runs on a Docker target and connects **outbound** to the InitPad
control plane. It does not expose SSH, a Docker API or a management HTTP port.
The target therefore needs Docker and outbound HTTPS, not Node.js.

The implemented runtime provides enrollment, a root-only credential file,
Docker capability discovery, heartbeat, a durable leased-job transport and an
allocation-scoped Docker lifecycle engine. The wire protocol deliberately has
no generic shell endpoint. Real project delivery remains disabled until the
control plane can attach a verified artifact and masked environment config to
the restricted operations.

The repository currently builds the Agent as an executable Node.js package and
as a minimal container image. The local lab below is the supported acceptance
path during development. Publishing a signed/versioned release image and its
production installer belongs to the final Agent release gate; the UI command is
the post-install enrollment command, not an implicit remote installer.

## Local acceptance without a VM

The lab uses a dedicated Docker-in-Docker daemon. It never gives the Agent the
host socket used by InitPad, so it represents a separate customer target even
though everything runs on one development machine.

1. Start the normal platform with `deploy/install.sh`.
2. In **Infrastructure**, add `Docker (InitPad Agent)` with an application base
   URL such as `http://127.0.0.1`.
3. Generate an enrollment token, but do not close the dialog yet.
4. From `deploy/`, run:

   ```sh
   ./agent-lab.sh build
   ./agent-lab.sh enroll
   ./agent-lab.sh start
   ./agent-lab.sh logs
   ```

5. Paste the token only into the hidden prompt. Within at most 30 seconds the UI
   changes to `online` and shows the Agent/Docker versions and last contact.
6. Stop the lab with `./agent-lab.sh stop`; after 90 seconds the UI changes to
   `offline`. Starting it again returns it to `online` without re-enrollment.
7. Click **Manage Agent → Test protocol**. The job moves through `queued`,
   `leased` and `succeeded`, its progress advances for 35 seconds and `attempt`
   remains 1 during a normal run. The probe does not create a container.
8. Click **Test Docker**. A digest-pinned Nginx image exercises create, health,
   bounded logs, replacement, rollback, stop, start and remove. The newest
   `lifecycle-test` entry must finish as `succeeded` with the message
   `Docker lifecycle test completed and cleaned up`.
9. Confirm that the isolated target contains no diagnostic residue:

   ```sh
   ./agent-lab.sh docker ps -a --filter label=com.initpad.managed=true
   ./agent-lab.sh docker image inspect \
     nginx@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa
   ./agent-lab.sh docker network inspect net-<workspace-slug>-diagnostic
   ```

   The first command prints no workload; both inspect commands return not
   found when the test pulled the image and created the network itself. An
   image already cached before the test is intentionally preserved.
10. **Disable Agent** invalidates the credential. The running process receives
   `401`, logs `agent.credential_rejected` and exits; a new enrollment is then
   required.

To verify lease recovery, start another probe, stop `agent-lab` after it becomes
`leased`, wait at least 30 seconds and start it again. The same job is reclaimed
as `attempt 2` and finishes successfully. A stale first attempt cannot renew or
publish progress after reassignment.

`INITPAD_AGENT_LAB_URL` overrides the control-plane URL when the web port or
hostname differs. HTTP is accepted only because the lab passes the explicit
`--allow-insecure-http` flag; real internet-facing installations require HTTPS.

## Credential storage

The credential is written atomically to
`/var/lib/initpad-agent/agent.json`. The directory is mode `0700`, the file is
mode `0600`, and symlink/non-regular config files are rejected. Database and
Agent logs never contain the plaintext credential or a job lease token. The
database stores only SHA-256 hashes of both credential types. Possession of the
long-lived credential authorizes only the physical target to which enrollment
bound it; each claimed job additionally requires its short-lived fencing token.

## Docker lifecycle boundary

Agent 0.3.0 accepts a strict, versioned payload containing only allocation ID,
namespace, project/environment identity, revision, immutable image digest,
container port and health path. Unknown fields are rejected. The engine never
accepts a command, entrypoint, bind mount, privileged mode, host network or
secret value.

Container and network labels must match the target and allocation before every
mutation. A same-named foreign object is treated as a collision and left
untouched. Candidate workloads receive CPU, memory, PID and log limits,
`no-new-privileges` and a small capability allow-list. A candidate starts with
no restart policy, becomes `unless-stopped` only after health succeeds, and
replaces the current revision atomically enough for the single-host prototype.
Application logs are tail-bounded to 32 KiB.
