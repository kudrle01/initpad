// Checks that the documents describing the current release state name the
// newest published platform release and the reviewed Agent release.
//
// The platform version is read from GitHub, because deploy/platform-version.json
// moves to the next version before that version is published. The Agent version
// is the reviewed one distributed by self-hosted installations
// (deploy/agent-release.env); a newer stable Agent release is reported so it can
// be reviewed.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** Documents and the exact text each must contain for the current versions. */
export function requiredMentions({ platform, agent }) {
  return {
    'README.md': [
      `Nejnovější veřejný podepsaný release \`${platform}\``,
      // Rychlé spuštění installs the newest signed tag, not main. The tag only
      // exists after publishing, so this check (not release:platform:prepare)
      // keeps the command current.
      `git clone --branch initpad-v${platform} `,
      `--tag initpad-v${platform}`,
      `Doporučený release \`${agent}\``,
      `--tag agent-v${agent}`,
    ],
    'docs/RELEASE_READINESS.md': [
      `doporučený Agent ${agent}`,
      `vydaná platforma \`initpad-v${platform}\``,
      `--tag initpad-v${platform}`,
      `--tag agent-v${agent}`,
    ],
    'apps/agent/README.md': [`releasem je Agent ${agent}`],
    'THREAT_MODEL.md': [`Doporučený Agent ${agent}`],
  };
}

export function findStaleDocuments({ read, platform, agent }) {
  const stale = [];
  for (const [path, mentions] of Object.entries(requiredMentions({ platform, agent }))) {
    const content = read(path);
    for (const mention of mentions) {
      if (!content.includes(mention)) stale.push(`${path}: expected "${mention}"`);
    }
  }
  return stale;
}

function compare(a, b) {
  const [, ...x] = VERSION.exec(a).map(Number);
  const [, ...y] = VERSION.exec(b).map(Number);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Newest stable (not draft, not prerelease) version published with a tag prefix. */
export function latestStable(releases, prefix) {
  const versions = releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => release.tag_name)
    .filter((tag) => tag.startsWith(prefix) && VERSION.test(tag.slice(prefix.length)))
    .map((tag) => tag.slice(prefix.length));
  return versions.sort(compare).at(-1) ?? null;
}

export function reviewedAgentVersion(root = repositoryRoot) {
  const env = readFileSync(resolve(root, 'deploy/agent-release.env'), 'utf8');
  const version = /^INITPAD_AGENT_RELEASE_VERSION=(\S+)$/m.exec(env)?.[1];
  if (!version || !VERSION.test(version)) {
    throw new Error('deploy/agent-release.env has no valid INITPAD_AGENT_RELEASE_VERSION');
  }
  return version;
}

async function fetchReleases(repository, token) {
  const releases = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'initpad-docs-freshness',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!response.ok) throw new Error(`GitHub releases request failed: HTTP ${response.status}`);
    const batch = await response.json();
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return releases;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const repository = process.env.GITHUB_REPOSITORY || 'kudrle01/initpad';
    const releases = await fetchReleases(repository, process.env.GITHUB_TOKEN);
    const platform = latestStable(releases, 'initpad-v');
    if (!platform) throw new Error('no stable initpad-v release found');
    const agent = reviewedAgentVersion();
    const latestAgent = latestStable(releases, 'agent-v');

    const stale = findStaleDocuments({
      read: (path) => readFileSync(resolve(repositoryRoot, path), 'utf8'),
      platform,
      agent,
    });
    if (latestAgent && compare(latestAgent, agent) > 0) {
      stale.push(
        `deploy/agent-release.env: Agent ${latestAgent} is released but ${agent} is still the reviewed release`,
      );
    }
    if (stale.length > 0) {
      process.stdout.write(
        `Documentation is behind platform ${platform} / Agent ${agent}:\n${stale
          .map((line) => `- ${line}`)
          .join('\n')}\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(`Documentation names platform ${platform} and Agent ${agent}.\n`);
    }
  } catch (error) {
    process.stderr.write(
      `docs-freshness: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}
