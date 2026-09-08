# Releasing InitPad Agent

Agent releases are created only from a version tag. The workflow builds one OCI
index for Linux `amd64` and `arm64`, attaches BuildKit SBOM and maximum
provenance, signs the immutable digest and release files with keyless Cosign,
and creates a GitHub release. It never publishes `latest`.

## Publish

1. Change the version in `apps/agent/package.json`, `apps/agent/src/types.ts`
   and the OCI version label in `apps/agent/Dockerfile`. Run
   `npm run check:release` and commit the change.
2. Create and push an annotated tag matching the version exactly:

   ```sh
   git tag -a agent-v0.9.0 -m 'InitPad Agent 0.9.0'
   git push origin agent-v0.9.0
   ```

   Protect the `agent-v*` tag pattern so only release maintainers can create or
   update it. Never move a published release tag.

3. The **Release InitPad Agent** workflow refuses a mismatched tag or an
   existing version tag before it builds. After it succeeds, copy the
   `immutableReference` from `initpad-agent-release.json` in the GitHub release.
4. Set that full `ghcr.io/.../initpad-agent@sha256:...` value as
   `INITPAD_AGENT_IMAGE` in the control-plane deployment and run
   `deploy/install.sh`. The enrollment dialog will then offer the verified
   one-command installer.

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
cosign verify \
  --certificate-identity 'https://github.com/OWNER/REPOSITORY/.github/workflows/release-agent.yml@refs/tags/agent-v0.9.0' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  'ghcr.io/OWNER/initpad-agent@sha256:DIGEST'
```

Download the release assets into one directory, then verify their checksums and
the checksum signature:

```sh
sha256sum --check SHA256SUMS
cosign verify-blob \
  --bundle SHA256SUMS.sigstore.json \
  --certificate-identity 'https://github.com/OWNER/REPOSITORY/.github/workflows/release-agent.yml@refs/tags/agent-v0.9.0' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  SHA256SUMS
```

The image SBOM is both a release asset and attached to the OCI image. Inspect a
platform-specific SPDX document without pulling the image:

```sh
docker buildx imagetools inspect 'ghcr.io/OWNER/initpad-agent@sha256:DIGEST' \
  --format '{{ json (index .SBOM "linux/amd64").SPDX }}'
```

Publishing is not the acceptance result. Before enabling a release for users,
install it on a clean Linux host and verify first enrollment, restart after a
host reboot, update to a newer digest, rollback from a deliberately unhealthy
digest and preservation of existing workloads when the Agent is disconnected.
