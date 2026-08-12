# InitPad Agent

InitPad Agent runs on a Docker target and connects **outbound** to the InitPad
control plane. It does not expose SSH, a Docker API or a management HTTP port.
The target therefore needs Docker and outbound HTTPS, not Node.js.

This milestone implements enrollment, a root-only credential file, Docker
capability discovery and heartbeat. Delivery jobs and Docker lifecycle commands
arrive in the following Agent milestones; the current protocol deliberately has
no generic shell endpoint.

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
7. **Disable Agent** invalidates the credential. The running process receives
   `401`, logs `agent.credential_rejected` and exits; a new enrollment is then
   required.

`INITPAD_AGENT_LAB_URL` overrides the control-plane URL when the web port or
hostname differs. HTTP is accepted only because the lab passes the explicit
`--allow-insecure-http` flag; real internet-facing installations require HTTPS.

## Credential storage

The credential is written atomically to
`/var/lib/initpad-agent/agent.json`. The directory is mode `0700`, the file is
mode `0600`, and symlink/non-regular config files are rejected. Database and
Agent logs never contain the plaintext credential. Possession of the credential
authorizes only the physical target to which enrollment bound it.
