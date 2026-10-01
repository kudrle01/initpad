# Releasing InitPad Agent

Agent releases are created only from a version tag. The workflow builds one OCI
index for Linux `amd64` and `arm64`, attaches BuildKit SBOM and maximum
provenance, signs the immutable digest and release files with keyless Cosign,
and creates a GitHub prerelease. It never publishes a mutable `latest` image
tag. The release is promoted to stable only after live host acceptance.

## Publish

1. Change the version in `apps/agent/package.json`, `apps/agent/src/types.ts`
   and the OCI version label in `apps/agent/Dockerfile`. Run
   `npm run check:release` and commit the change.
2. Create and push an annotated tag matching the version exactly:

   ```sh
   version=$(node -p "require('./apps/agent/package.json').version")
   git tag -a "agent-v${version}" -m "InitPad Agent ${version}"
   git push origin "agent-v${version}"
   ```

   Protect the `agent-v*` tag pattern so only release maintainers can create or
   update it. Never move a published release tag.

3. The **Release InitPad Agent** workflow refuses a mismatched tag or an
   existing version tag before it builds. It publishes the signed result as a
   GitHub prerelease so the default stable catalog cannot offer an unaccepted
   runtime to customer installations.
4. Audit the candidate while it is still a prerelease:

   ```sh
   npm run audit:public-release -- --tag "agent-v${version}" --allow-prerelease
   ```

5. On a disposable acceptance control plane set
   `INITPAD_AGENT_UPDATE_CHANNEL=candidate`, restart the API and follow
   [`ACCEPTANCE.md`](./ACCEPTANCE.md). The UI labels this channel explicitly.
   Stable installations keep the default `stable` value and ignore the
   prerelease.
6. After every required live check passes, promote the existing release without
   rebuilding or moving its tag:

   ```sh
   gh release edit "agent-v${version}" --prerelease=false --latest
   npm run audit:public-release -- --tag "agent-v${version}"
   ```

   Then update `deploy/agent-release.env` from the signed manifest and include
   that reviewed bootstrap pair in the next platform release. Existing Agents
   discover the newly stable release through the signed catalog; operators do
   not edit `.env` for every Agent update.

For unauthenticated customer installation, the GHCR package must be public.
After its first publication, change the package visibility once in GitHub
Packages. This cannot safely be automated and GitHub warns that changing a
package to public cannot be undone. The source repository may remain private;
the image's signature identity intentionally still names its repository and
workflow.

GitHub artifact attestations are added automatically for public repositories.
For a private GitHub Enterprise Cloud repository, set the repository variable
`INITPAD_ENABLE_PRIVATE_ATTESTATIONS=true`. Standard private Free/Pro/Team
repositories do not support GitHub artifact attestations, so Cosign remains the
portable release signature in every case.

## Verify

Replace the placeholders with the release values:

```sh
TAG=agent-vX.Y.Z
cosign verify \
  --certificate-identity "https://github.com/OWNER/REPOSITORY/.github/workflows/release-agent.yml@refs/tags/${TAG}" \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  'ghcr.io/OWNER/initpad-agent@sha256:DIGEST'
```

Download the release assets into one directory, then verify their checksums and
the checksum signature:

```sh
TAG=agent-vX.Y.Z
sha256sum --check SHA256SUMS
cosign verify-blob \
  --bundle SHA256SUMS.sigstore.json \
  --certificate-identity "https://github.com/OWNER/REPOSITORY/.github/workflows/release-agent.yml@refs/tags/${TAG}" \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  SHA256SUMS
```

The signed release also contains `initpad-agent-host-acceptance.sh`. Verify it
through the same `SHA256SUMS` before copying it to the disposable Agent host;
it supplies the non-destructive disconnect/reconnect evidence checkpoints in
`ACCEPTANCE.md`.

The image SBOM is both a release asset and attached to the OCI image. Inspect a
platform-specific SPDX document without pulling the image:

```sh
docker buildx imagetools inspect 'ghcr.io/OWNER/initpad-agent@sha256:DIGEST' \
  --format '{{ json (index .SBOM "linux/amd64").SPDX }}'
```

Publishing a prerelease is not the acceptance result. Follow the reproducible clean-host
[`ACCEPTANCE.md`](./ACCEPTANCE.md) runbook before approving a release for
production. It verifies first enrollment, restart after a host reboot,
idempotent reinstall, rollback from a deliberately unhealthy digest and
preservation of existing workloads when the Agent is disconnected. A genuine
upgrade checkpoint closes only when a later signed release exists.

For the reboot checkpoint, run the release asset's `before-reboot` command
before restarting the host and `after-reboot` after login. The pair rejects a
disabled systemd Docker service, an incorrect restart policy, a container
replacement and a changed target identity instead of relying on a visual
online/offline observation.
