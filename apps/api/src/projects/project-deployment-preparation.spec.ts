import { existsSync } from 'fs';
import { ProjectDeploymentPreparation } from './project-deployment-preparation';

const REPOSITORY = {
  provider: 'gitea',
  repositoryId: '101',
  owner: 'acme',
  name: 'api',
  fullName: 'acme/api',
  defaultBranch: 'main',
  repoUrl: 'https://git.test/acme/api',
  installationId: null,
} as const;

function input(overrides: Record<string, unknown> = {}) {
  return {
    environmentId: 'env-1',
    provider: 'docker' as const,
    template: {
      id: 'node',
      name: 'Node',
      language: 'TypeScript',
      artifact: 'runtime' as const,
      compatibleProviders: ['docker' as const],
      description: 'Node service',
    },
    repository: REPOSITORY,
    projectRepoPath: '/workspace/acme-api',
    version: 'a'.repeat(40),
    useRegistry: true,
    testedImageRef: 'registry.test/acme/api:' + 'a'.repeat(40),
    resolveActor: jest.fn(async () => ({ username: 'alice', token: 'token' })),
    onProgress: jest.fn(),
    ...overrides,
  };
}

function make(
  deployment: Record<string, unknown>,
  scm: Record<string, unknown> = {},
  appConfig: Record<string, unknown> = {
    configVarsForDeploy: jest.fn(async () => ({})),
  },
) {
  return new ProjectDeploymentPreparation(
    deployment as never,
    { provider: jest.fn(() => scm) } as never,
    appConfig as never,
  );
}

describe('ProjectDeploymentPreparation', () => {
  it('keeps registry-based Docker deploys independent of a source checkout', async () => {
    const scm = { downloadArchive: jest.fn() };
    const appConfig = {
      configVarsForDeploy: jest.fn(async () => ({ DATABASE_URL: 'secret' })),
    };
    const preparation = make({}, scm, appConfig);
    const prepareInput = input();

    const prepared = await preparation.prepare(prepareInput);

    expect(prepared.repoPath).toBe('/workspace/acme-api');
    expect(prepared.envVars).toEqual({ DATABASE_URL: 'secret' });
    expect(prepareInput.resolveActor).not.toHaveBeenCalled();
    expect(scm.downloadArchive).not.toHaveBeenCalled();
    prepared.cleanup();
  });

  it('owns and removes the temporary directory of an extracted SFTP artifact', async () => {
    let extractedDir = '';
    const deployment = {
      extractArtifact: jest.fn(async (_image: string, _path: string, output: string) => {
        extractedDir = output;
      }),
    };
    const preparation = make(deployment);

    const prepared = await preparation.prepare(
      input({
        provider: 'sftp',
        template: {
          id: 'php',
          name: 'PHP',
          language: 'PHP',
          artifact: 'runtime',
          compatibleProviders: ['sftp'],
          buildArtifactPath: '/app',
          description: 'PHP app',
        },
      }),
    );

    expect(existsSync(extractedDir)).toBe(true);
    expect(prepared.repoPath).toBe(`${extractedDir}/app`);
    expect(prepared.artifactDir).toBeUndefined();
    prepared.cleanup();
    prepared.cleanup();
    expect(existsSync(extractedDir)).toBe(false);
  });

  it('removes the temporary directory when artifact extraction fails', async () => {
    let extractedDir = '';
    const deployment = {
      extractArtifact: jest.fn(async (_image: string, _path: string, output: string) => {
        extractedDir = output;
        throw new Error('corrupt image');
      }),
    };
    const preparation = make(deployment);

    await expect(
      preparation.prepare(
        input({
          provider: 'sftp',
          template: {
            id: 'php',
            name: 'PHP',
            language: 'PHP',
            artifact: 'runtime',
            compatibleProviders: ['sftp'],
            buildArtifactPath: '/app',
            description: 'PHP app',
          },
        }),
      ),
    ).rejects.toThrow('corrupt image');
    expect(existsSync(extractedDir)).toBe(false);
  });

  it('cleans a downloaded source archive when config loading fails', async () => {
    const cleanup = jest.fn();
    const scm = {
      downloadArchive: jest.fn(async () => ({ dir: '/tmp/source', cleanup })),
    };
    const appConfig = {
      configVarsForDeploy: jest.fn(async () => {
        throw new Error('secret unavailable');
      }),
    };
    const preparation = make({}, scm, appConfig);

    await expect(
      preparation.prepare(
        input({
          provider: 'ssh',
          useRegistry: true,
          template: {
            id: 'node',
            name: 'Node',
            language: 'TypeScript',
            artifact: 'runtime',
            compatibleProviders: ['ssh'],
            description: 'Node service',
          },
        }),
      ),
    ).rejects.toThrow('secret unavailable');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
