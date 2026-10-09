// Pinned immutable commit for actions/upload-artifact v7.0.1. A tag alone is
// mutable and therefore unsuitable on the build-to-deploy trust boundary.
export const UPLOAD_ARTIFACT_ACTION =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

const REGISTRY_LOGIN =
  '          echo "${{ secrets.INITPAD_REGISTRY_PASSWORD }}" | \\\n' +
  '            docker login "${{ secrets.INITPAD_REGISTRY }}" -u "${{ secrets.INITPAD_REGISTRY_USER }}" --password-stdin\n';
const BUILD_CACHE_NAME =
  "          # Build layers are cached next to the image, in this repository's registry.\n" +
  '          echo "CACHE=${IMAGE%:*}:buildcache" >> "$GITHUB_ENV"\n';
// The layer cache lives in the self-hosted registry (ADR-139); GitHub hands
// the image over as an artifact and has no such registry.
const BUILD_CACHE_FLAG = /^ {12}--cache-(?:from|to) "type=registry,[^"\n]*" \\\n/gm;
const PUBLISH_STEP = '      - name: publish image\n        run: docker push "$IMAGE"\n';
const RESULT = '"ciStatus":"${{ job.status }}"}\'';

function replaceOnce(workflow: string, search: string, replacement: string, what: string): string {
  if (!workflow.includes(search)) throw new Error(what);
  return workflow.replace(search, replacement);
}

/**
 * Converts the shared Gitea workflow into the hosted-edition GitHub workflow.
 * Gitea keeps publishing to the bundled registry. GitHub instead hands the
 * exact tested image to InitPad as an immutable Actions artifact (ADR-049), so
 * neither a user PAT nor private-GHCR credentials enter the control plane.
 */
export function adaptWorkflowForGitHub(source: string, filename: string): string {
  let workflow = source;
  if (!/^permissions:/m.test(workflow)) {
    workflow = workflow.replace(/^on: \[push\]$/m, 'on: [push]\n\npermissions:\n  contents: read');
  }

  const missing = (part: string) => `Could not locate the ${part} in '${filename}'`;
  workflow = replaceOnce(
    workflow,
    PUBLISH_STEP,
    [
      '      - name: save image',
      '        run: docker save "$IMAGE" -o initpad-image.tar',
      '      - name: upload immutable image artifact',
      '        id: initpad-artifact',
      `        uses: ${UPLOAD_ARTIFACT_ACTION} # v7.0.1`,
      '        with:',
      '          path: initpad-image.tar',
      '          archive: false',
      '          retention-days: 1',
      '          if-no-files-found: error',
      '',
    ].join('\n'),
    missing('image publication step'),
  );
  workflow = replaceOnce(workflow, REGISTRY_LOGIN, '', missing('registry login'));
  workflow = replaceOnce(workflow, BUILD_CACHE_NAME, '', missing('build cache name'));
  workflow = workflow.replace(BUILD_CACHE_FLAG, '');
  workflow = replaceOnce(
    workflow,
    ':${{ github.sha }}" | tr',
    ':${{ github.sha }}-${{ github.run_id }}" | tr',
    missing('image tag'),
  );
  workflow = replaceOnce(
    workflow,
    RESULT,
    '"ciStatus":"${{ job.status }}",' +
      '"artifactId":"${{ steps.initpad-artifact.outputs.artifact-id }}",' +
      '"artifactDigest":"${{ steps.initpad-artifact.outputs.artifact-digest }}"}\'',
    missing('InitPad callback'),
  );

  if (
    workflow.includes('INITPAD_REGISTRY_PASSWORD') ||
    workflow.includes('INITPAD_REGISTRY_USER') ||
    workflow.includes('docker push') ||
    workflow.includes('--cache-')
  ) {
    throw new Error(`Could not remove the self-hosted registry from '${filename}'`);
  }
  return workflow;
}
