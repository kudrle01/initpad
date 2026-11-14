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

    expect(prepared.repoPath).toBe('');
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

  it('cleans a downloaded source archive when Docker bootstrap config loading fails', async () => {
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
          provider: 'docker',
          useRegistry: false,
          template: {
            id: 'node',
            name: 'Node',
            language: 'TypeScript',
            artifact: 'runtime',
            compatibleProviders: ['docker'],
            description: 'Node service',
          },
        }),
      ),
    ).rejects.toThrow('secret unavailable');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('propagates the concrete source download error instead of using a local checkout', async () => {
    const scm = {
      downloadArchive: jest.fn(async () => {
        throw new Error(
          'Could not download the source of acme/api@aaaaaaaaaaaa from Gitea: HTTP 502',
        );
      }),
    };
    const preparation = make({}, scm);

    await expect(
      preparation.prepare(
        input({
          provider: 'sftp',
          useRegistry: false,
          template: {
            id: 'static',
            name: 'Static',
            language: 'HTML',
            artifact: 'static',
            compatibleProviders: ['sftp'],
            description: 'Static site',
          },
        }),
      ),
    ).rejects.toThrow('from Gitea: HTTP 502');
    expect(scm.downloadArchive).toHaveBeenCalledTimes(1);
  });

  it('deploys exactly the downloaded source tree', async () => {
    const cleanup = jest.fn();
    const scm = { downloadArchive: jest.fn(async () => ({ dir: '/tmp/source', cleanup })) };
    const prepared = await make({}, scm).prepare(input({ provider: 'sftp', useRegistry: false }));
    expect(prepared.repoPath).toBe('/tmp/source');
    prepared.cleanup();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
