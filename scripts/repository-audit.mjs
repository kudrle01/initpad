import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, extname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

const trackedFiles = git(['ls-files', '-z']).split('\0').filter(Boolean);
const tracked = new Set(trackedFiles);
const failures = [];
const notices = [];

const forbiddenTrackedPaths = [
  { pattern: /(^|\/)\.DS_Store$/, reason: 'macOS metadata' },
  { pattern: /(^|\/)node_modules\//, reason: 'installed dependencies' },
  { pattern: /(^|\/)dist\//, reason: 'generated build output' },
  { pattern: /^\.workspace\//, reason: 'generated project workspaces' },
  { pattern: /^deploy\/(?:backups|\.runtime)\//, reason: 'runtime or backup data' },
  { pattern: /(^|\/)\.env$/, reason: 'unreviewed environment values' },
  { pattern: /(^|\/)[A-Z0-9_-]*HANDOFF\.md$/i, reason: 'temporary internal notes' },
  { pattern: /(^|\/)AUDIT_RESOLUTION_.*\.md$/i, reason: 'local audit working notes' },
  { pattern: /^VYSVETLENI_.*\.md$/, reason: 'personal explanation notes' },
  { pattern: /(^|\/)AGENTS\.md$/i, reason: 'local tool instructions' },
  {
    pattern: /^deploy\/DEPLOYMENT_RASPBERRY_PI\.md$/,
    reason: 'machine-specific deployment notes',
  },
  { pattern: /\.(?:pem|p12|pfx)$/i, reason: 'private key or certificate bundle' },
];

for (const path of trackedFiles) {
  for (const rule of forbiddenTrackedPaths) {
    if (rule.pattern.test(path)) {
      failures.push(`${path}: must not track ${rule.reason}`);
    }
  }
}

const requiredPublicDocs = [
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'PRODUCT_ROADMAP.md',
  'DECISIONS.md',
  'THREAT_MODEL.md',
  'docs/ARCHITECTURE.md',
  'docs/EVALUATION.md',
  'docs/RELEASE_READINESS.md',
  'deploy/README.md',
  'deploy/OPERATIONS.md',
  'deploy/SELF_HOSTED_ACCEPTANCE.md',
  'apps/agent/README.md',
  'apps/agent/ACCEPTANCE.md',
  'apps/agent/RELEASING.md',
];

for (const path of requiredPublicDocs) {
  if (!tracked.has(path)) failures.push(`${path}: required public documentation is missing`);
}

const executableOperations = [
  'deploy/install.sh',
  'deploy/prepare-rootless-runner.sh',
  'deploy/configure-agent-release.sh',
  'deploy/self-hosted-check.sh',
  'deploy/backup.sh',
  'deploy/restore.sh',
  'deploy/recovery-drill.sh',
  'deploy/cleanup.sh',
  'deploy/reset.sh',
  'deploy/agent-lab.sh',
  'apps/agent/install.sh',
  'scripts/test-template-images.sh',
];
const indexModes = new Map(
  git(['ls-files', '-s', '--', ...executableOperations])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [metadata, path] = line.split('\t');
      return [path, metadata.split(' ')[0]];
    }),
);

for (const path of executableOperations) {
  if (!tracked.has(path)) {
    failures.push(`${path}: required operational command is missing`);
  } else if (indexModes.get(path) !== '100755') {
    failures.push(`${path}: operational command is not executable in Git`);
  }
}

const textFiles = new Map();
for (const path of trackedFiles) {
  if (path === 'package-lock.json' || /\.(?:png|jpe?g|gif|ico|woff2?|zip|gz)$/i.test(path)) {
    continue;
  }
  const content = readFileSync(resolve(root, path));
  if (content.includes(0)) continue;
  textFiles.set(path, content.toString('utf8'));
}

const sensitiveContentRules = [
  { pattern: /\/Users\/[^/\s'"`]+\//, reason: 'a developer-specific absolute home path' },
  {
    pattern: /[A-Za-z]:\\Users\\[^\\\s'"`]+\\/i,
    reason: 'a developer-specific absolute home path',
  },
  { pattern: /initpad_enroll_[A-Za-z0-9_-]{24,}/, reason: 'an Agent enrollment token' },
  { pattern: /gh[pousr]_[A-Za-z0-9]{20,}/, reason: 'a GitHub access token' },
  { pattern: /AKIA[0-9A-Z]{16}/, reason: 'an AWS access key ID' },
];

for (const [path, content] of textFiles) {
  for (const rule of sensitiveContentRules) {
    if (rule.pattern.test(content)) {
      failures.push(`${path}: contains ${rule.reason}`);
    }
  }
}

const sourceGroups = [
  { root: 'apps/api/src', entries: ['apps/api/src/main.ts'] },
  { root: 'apps/agent/src', entries: ['apps/agent/src/cli.ts'] },
  { root: 'apps/web/src', entries: ['apps/web/src/main.tsx'] },
];

function productionSource(path, sourceRoot) {
  return (
    path.startsWith(`${sourceRoot}/`) &&
    ['.ts', '.tsx'].includes(extname(path)) &&
    !/\.(?:spec|test)\.tsx?$/.test(path) &&
    !path.endsWith('.d.ts')
  );
}

function importedSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return specifiers;
}

function resolveSourceImport(importer, specifier, sourceRoot, candidates) {
  const base = specifier.startsWith('@/')
    ? posix.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? posix.normalize(posix.join(posix.dirname(importer), specifier))
      : undefined;
  if (!base) return undefined;
  const withoutJs = base.replace(/\.js$/, '');
  for (const candidate of [
    base,
    withoutJs,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    `${withoutJs}/index.ts`,
    `${withoutJs}/index.tsx`,
  ]) {
    if (candidates.has(candidate)) return candidate;
  }
  return undefined;
}

for (const group of sourceGroups) {
  const sources = new Set(trackedFiles.filter((path) => productionSource(path, group.root)));
  const reachable = new Set();
  const queue = [...group.entries];

  while (queue.length > 0) {
    const path = queue.shift();
    if (!path || reachable.has(path) || !sources.has(path)) continue;
    reachable.add(path);
    const content = textFiles.get(path) ?? '';
    for (const specifier of importedSpecifiers(content)) {
      const dependency = resolveSourceImport(path, specifier, group.root, sources);
      if (dependency && !reachable.has(dependency)) queue.push(dependency);
    }
  }

  for (const path of [...sources].sort()) {
    if (!reachable.has(path))
      failures.push(`${path}: production module is not reachable from an entry point`);
  }

  const largeModules = [...sources]
    .map((path) => ({ path, lines: (textFiles.get(path) ?? '').split('\n').length }))
    .filter(({ lines }) => lines >= 500)
    .sort((a, b) => b.lines - a.lines);
  if (largeModules.length > 0) {
    notices.push(
      `${group.root}: review hotspots ${largeModules
        .map(({ path, lines }) => `${path.slice(group.root.length + 1)} (${lines})`)
        .join(', ')}`,
    );
  }
}

for (const path of ['apps/agent/install.sh', 'deploy/configure-agent-release.sh']) {
  execFileSync('sh', ['-n', path], { cwd: root });
}
for (const path of [
  'deploy/install.sh',
  'deploy/prepare-rootless-runner.sh',
  'deploy/install-release.sh',
  'deploy/self-hosted-check.sh',
  'deploy/backup.sh',
  'deploy/restore.sh',
  'deploy/recovery-drill.sh',
]) {
  execFileSync('bash', ['-n', path], { cwd: root });
}
const agentPackage = JSON.parse(readFileSync(resolve(root, 'apps/agent/package.json'), 'utf8'));
for (const path of ['apps/agent/src/types.ts', 'apps/agent/Dockerfile']) {
  if (!(textFiles.get(path) ?? '').includes(agentPackage.version)) {
    failures.push(`${path}: does not carry Agent version ${agentPackage.version}`);
  }
}

const agentReleaseChannelPath = 'deploy/agent-release.env';
if (!tracked.has(agentReleaseChannelPath)) {
  failures.push(`${agentReleaseChannelPath}: reviewed Agent release channel is missing`);
} else {
  const channel = textFiles.get(agentReleaseChannelPath) ?? '';
  const image = channel.match(/^INITPAD_AGENT_IMAGE=(.+)$/m)?.[1] ?? '';
  const version = channel.match(/^INITPAD_AGENT_RELEASE_VERSION=(.+)$/m)?.[1] ?? '';
  if (!/^[^\s]+@sha256:[a-f0-9]{64}$/.test(image)) {
    failures.push(`${agentReleaseChannelPath}: Agent image is not an immutable OCI digest`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    failures.push(`${agentReleaseChannelPath}: Agent version is not a stable semantic version`);
  }
}

const requiredAutomation = [
  '.gitleaks.toml',
  '.gitleaksignore',
  '.github/dependabot.yml',
  '.github/workflows/container-images.yml',
  '.github/workflows/release-agent.yml',
  '.github/workflows/release-platform.yml',
];
for (const path of requiredAutomation) {
  if (!tracked.has(path)) failures.push(`${path}: required dependency automation is missing`);
}

for (const path of trackedFiles.filter((path) => /^\.github\/workflows\/.*\.ya?ml$/.test(path))) {
  const workflow = textFiles.get(path) ?? '';
  const actionReferences = [...workflow.matchAll(/^\s*uses:\s*[^\s@]+@([^\s#]+)/gm)];
  for (const [, reference] of actionReferences) {
    if (!/^[a-f0-9]{40}$/.test(reference)) {
      failures.push(`${path}: action reference ${reference} is not a full commit SHA`);
    }
  }
}

for (const [releaseWorkflowPath, contracts] of [
  [
    '.github/workflows/release-agent.yml',
    [
      'platforms: linux/amd64,linux/arm64',
      'sbom: true',
      'provenance: mode=max',
      'cosign sign --yes',
      'subject-checksums:',
      'Refuse an existing version tag',
    ],
  ],
  [
    '.github/workflows/release-platform.yml',
    [
      'platforms: linux/amd64,linux/arm64',
      'sbom: true',
      'provenance: mode=max',
      'cosign sign --yes',
      'subject-checksums:',
      'Refuse existing immutable version tags',
      'initpad-supervisor',
    ],
  ],
]) {
  const workflow = textFiles.get(releaseWorkflowPath) ?? '';
  if (![...workflow.matchAll(/^\s*uses:\s*[^\s@]+@([^\s#]+)/gm)].length) {
    failures.push(`${releaseWorkflowPath}: does not invoke any pinned actions`);
  }
  for (const contract of contracts) {
    if (!workflow.includes(contract)) {
      failures.push(`${releaseWorkflowPath}: missing release contract ${contract}`);
    }
  }
}

const digestPattern = /@sha256:[a-f0-9]{64}$/;
for (const path of trackedFiles.filter((path) => /(^|\/)Dockerfile$/.test(path))) {
  const content = textFiles.get(path) ?? '';
  const stages = new Set();
  for (const line of content.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/gim)) {
    const [, image, alias] = line;
    if (!stages.has(image) && !digestPattern.test(image)) {
      failures.push(`${path}: external base image ${image} is not pinned by digest`);
    }
    if (alias) stages.add(alias);
  }
  for (const line of content.matchAll(/^COPY\s+--from=(\S+)/gim)) {
    const image = line[1];
    if (!stages.has(image) && !/^\d+$/.test(image) && !digestPattern.test(image)) {
      failures.push(`${path}: external COPY image ${image} is not pinned by digest`);
    }
  }
}

const localComposeImages = new Set([
  'initpad-agent-lab:dev',
  // The self-hosted source install builds these local tags in place. Signed
  // releases replace all three through the generated digest-only override.
  '${INITPAD_API_IMAGE:-initpad-api:source}',
  '${INITPAD_WEB_IMAGE:-initpad-web:source}',
  '${INITPAD_SUPERVISOR_IMAGE:-initpad-supervisor:source}',
]);
for (const path of trackedFiles.filter((path) => /\.ya?ml$/.test(path))) {
  const content = textFiles.get(path) ?? '';
  for (const match of content.matchAll(/^\s*image:\s*["']?([^\s"']+)/gm)) {
    const image = match[1];
    if (!localComposeImages.has(image) && !digestPattern.test(image)) {
      failures.push(`${path}: external Compose image ${image} is not pinned by digest`);
    }
  }
  for (const match of content.matchAll(/docker:\/\/([^\s"']+)/g)) {
    const image = match[1];
    if (!digestPattern.test(image)) {
      failures.push(`${path}: runner image ${image} is not pinned by digest`);
    }
  }
}

for (const path of [
  'deploy/agent-lab-gateway-bootstrap.sh',
  'deploy/backup.sh',
  'deploy/restore.sh',
]) {
  const content = textFiles.get(path) ?? '';
  const imageReferences = content.match(
    /(?:alpine|caddy|postgres):[A-Za-z0-9._-]+(?:@sha256:[a-f0-9]{64})?/g,
  );
  for (const image of imageReferences ?? []) {
    if (!digestPattern.test(image)) {
      failures.push(`${path}: operational helper image ${image} is not pinned by digest`);
    }
  }
}

if (failures.length > 0) {
  console.error('Repository audit failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Repository audit passed (${trackedFiles.length} tracked files).`);
}

for (const notice of notices) console.log(`Notice: ${notice}`);
