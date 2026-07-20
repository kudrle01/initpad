// Pinned immutable commit for actions/upload-artifact v7.0.1. A tag alone is
// mutable and therefore unsuitable on the build-to-deploy trust boundary.
export const UPLOAD_ARTIFACT_ACTION =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

/**
 * Converts the shared Gitea workflow into the hosted-edition GitHub workflow.
 * Gitea keeps publishing to the bundled registry. GitHub instead hands the
 * exact tested image to InitPad as an immutable Actions artifact (ADR-049), so
 * neither a user PAT nor private-GHCR credentials enter the control plane.
 */
export function adaptWorkflowForGitHub(source: string, filename: string): string {
  let workflow = source;
  if (!/^permissions:/m.test(workflow)) {
    workflow = workflow.replace(
      /^on: \[push\]$/m,
      'on: [push]\n\npermissions:\n  contents: read',
    );
  }

  const dockerHeader = '  docker:\n    name: docker build\n';
  if (!workflow.includes(dockerHeader)) {
    throw new Error(`Could not locate the docker job in '${filename}'`);
  }
  workflow = workflow.replace(
    dockerHeader,
    [
      dockerHeader.trimEnd(),
      '    outputs:',
      '      artifact-id: ${{ steps.initpad-artifact.outputs.artifact-id }}',
      '      artifact-digest: ${{ steps.initpad-artifact.outputs.artifact-digest }}',
      '',
    ].join('\n'),
  );

  const registryLogin =
    '          echo "${{ secrets.INITPAD_REGISTRY_PASSWORD }}" | \\\n' +
    '            docker login "${{ secrets.INITPAD_REGISTRY }}" -u "${{ secrets.INITPAD_REGISTRY_USER }}" --password-stdin\n';
  if (!workflow.includes(registryLogin) || !workflow.includes('          docker push "$IMAGE"')) {
    throw new Error(`Could not locate the registry publication step in '${filename}'`);
  }
  workflow = workflow
    .replace(registryLogin, '')
    .replace(
      ':${{ github.sha }}" | tr',
      ':${{ github.sha }}-${{ github.run_id }}" | tr',
    )
    .replace(
      '          docker push "$IMAGE"',
      [
        '          docker save "$IMAGE" -o initpad-image.tar',
        '      - name: upload immutable image artifact',
        '        id: initpad-artifact',
        `        uses: ${UPLOAD_ARTIFACT_ACTION} # v7.0.1`,
        '        with:',
        '          path: initpad-image.tar',
        '          archive: false',
        '          retention-days: 1',
        '          if-no-files-found: error',
      ].join('\n'),
    );

  const callback =
    `            -d '{"repo":"\${{ github.repository }}","sha":"\${{ github.sha }}","ref":"\${{ github.ref_name }}"}'`;
  if (!workflow.includes(callback)) {
    throw new Error(`Could not locate the InitPad callback in '${filename}'`);
  }
  workflow = workflow.replace(
    callback,
    `            -d '{"repo":"\${{ github.repository }}","sha":"\${{ github.sha }}","ref":"\${{ github.ref_name }}","artifactId":"\${{ needs.docker.outputs.artifact-id }}","artifactDigest":"\${{ needs.docker.outputs.artifact-digest }}"}'`,
  );

  if (
    workflow.includes('INITPAD_REGISTRY_PASSWORD') ||
    workflow.includes('INITPAD_REGISTRY_USER') ||
    workflow.includes('docker push "$IMAGE"')
  ) {
    throw new Error(`Could not remove registry credentials from '${filename}'`);
  }
  if (!workflow.includes('${{ github.sha }}-${{ github.run_id }}')) {
    throw new Error(`Could not bind the image tag to a unique workflow run in '${filename}'`);
  }
  return workflow;
}
