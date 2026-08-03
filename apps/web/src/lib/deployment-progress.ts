const DEPLOYMENT_STAGES: ReadonlyArray<readonly [needle: string, percent: number]> = [
  ['waiting for ci build', 6],
  ['recovering tested github build', 10],
  ['ci runner started the build', 15],
  ['downloading and verifying tested image', 22],
  ['preparing deployment', 25],
  ['fetching & extracting tested artifact', 31],
  ['connecting to target', 35],
  ['preparing container runtime', 38],
  ['preparing release', 38],
  ['resolving tested image', 45],
  ['uploading archive', 48],
  ['uploading files', 48],
  ['extracting on the server', 62],
  ['extracting source', 62],
  ['replacing previous container', 67],
  ['installing production dependencies', 72],
  ['setting permissions', 76],
  ['publishing release', 82],
  ['publishing', 82],
  ['starting application', 87],
  ['starting container', 87],
  ['verifying deployment', 94],
];

/**
 * Converts provider progress messages into coarse end-to-end progress. The
 * percentage deliberately stops below 100: only the final environment state
 * may claim that a deployment completed successfully.
 */
export function deploymentProgress(message: string | null): number | null {
  if (!message) return null;
  const normalized = message.toLowerCase();
  const ratio = message.match(/(\d+)\s*\/\s*(\d+)/);

  // File-by-file SFTP upload is only one part of the deployment. Scale its
  // local counter into that phase instead of making the whole bar reach 100%.
  if (ratio && normalized.includes('uploading')) {
    const uploaded = Number(ratio[1]);
    const total = Math.max(1, Number(ratio[2]));
    return Math.min(68, Math.round(42 + (uploaded / total) * 26));
  }

  const stage = DEPLOYMENT_STAGES.find(([needle]) => normalized.includes(needle));
  if (stage) return stage[1];

  // Preserve useful counters emitted by future providers even before they
  // receive a named end-to-end stage mapping.
  if (ratio) {
    return Math.min(
      94,
      Math.round((Number(ratio[1]) / Math.max(1, Number(ratio[2]))) * 100),
    );
  }
  return null;
}
