import { ProjectQueries } from './project-queries';

const SHA = 'a'.repeat(40);
const TEMPLATE = { id: 'node', artifact: 'container' };

function make(
  data: {
    projects?: Array<Record<string, unknown>>;
    operations?: Array<Record<string, unknown>>;
    artifacts?: Array<Record<string, unknown>>;
  } = {},
) {
  const prisma = {
    project: {
      findMany: jest.fn(
        async () =>
          data.projects ?? [
            {
              id: 'p1',
              name: 'api',
              templateId: 'node',
              lastCommit: `ci: deploy ${SHA.slice(0, 7)}`,
              createdAt: new Date('2026-11-01T00:00:00Z'),
            },
            {
              id: 'p2',
              name: 'web',
              templateId: 'node',
              lastCommit: 'init: scaffold',
              createdAt: new Date('2026-11-02T00:00:00Z'),
            },
          ],
      ),
    },
    deploymentOperation: {
      findMany: jest.fn(
        async () =>
          data.operations ?? [
            {
              version: SHA,
              status: 'succeeded',
              createdAt: new Date('2026-11-10T00:00:00Z'),
              environment: { projectId: 'p1' },
              buildArtifact: { providerRunId: 'run-1' },
            },
          ],
      ),
    },
    buildArtifact: { findMany: jest.fn(async () => data.artifacts ?? []) },
  };
  const workspaces = { resolve: jest.fn(async () => ({ id: 'ws1' })) };
  const templates = { get: jest.fn(() => TEMPLATE) };
  const queries = new ProjectQueries(
    prisma as never,
    templates as never,
    {} as never,
    workspaces as never,
  );
  return { queries, prisma };
}

describe('ProjectQueries activity', () => {
  // Regression (audit P2): the feed made ~6 SCM calls per project on every
  // request and hid provider failures as "no activity".
  it('builds the default feed from InitPad records without any SCM call', async () => {
    const { queries } = make();
    const getCommits = jest.fn();

    const events = await queries.activity('u1', 'ws1');

    expect(getCommits).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        projectId: 'p1',
        sha: SHA,
        message: 'ci: deploy aaaaaaa',
        date: '2026-11-10T00:00:00.000Z',
        pipeline: [
          { name: 'build', status: 'success', url: null },
          { name: 'publish', status: 'success', url: null, source: 'platform' },
        ],
      }),
      expect.objectContaining({ projectId: 'p2', sha: 'initial', message: 'init: scaffold' }),
    ]);
  });

  it('bounds the database reads instead of loading whole histories', async () => {
    const { queries, prisma } = make();

    await queries.activity('u1', 'ws1');

    expect(prisma.deploymentOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 300 }),
    );
    expect(prisma.buildArtifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 300 }),
    );
  });

  it('shows a failed artifact verification as a failed build', async () => {
    const { queries } = make({
      operations: [],
      artifacts: [
        {
          projectId: 'p1',
          commitSha: SHA,
          status: 'failed',
          createdAt: new Date('2026-11-11T00:00:00Z'),
        },
      ],
    });

    const [event] = await queries.activity('u1', 'ws1');

    expect(event.pipeline).toEqual([{ name: 'build', status: 'failed', url: null }]);
  });

  it('requests only the five commits that can appear when SCM enrichment is asked for', async () => {
    const { queries } = make();
    const getCommits = jest.fn(async () => []);

    const feed = await queries.activityFeed('u1', 'ws1', true, getCommits);

    expect(getCommits).toHaveBeenNthCalledWith(1, 'p1', 5);
    expect(getCommits).toHaveBeenNthCalledWith(2, 'p2', 5);
    expect(feed.warnings).toEqual([]);
  });

  it('reports an SCM failure as a warning and keeps the database events', async () => {
    const { queries } = make();
    const getCommits = jest.fn(async (projectId: string) => {
      if (projectId === 'p1') throw new Error('Gitea is unreachable');
      return [
        {
          sha: 'b'.repeat(40),
          message: 'feat: landing page',
          author: 'alice',
          date: '2026-11-12T00:00:00.000Z',
          pipeline: [],
        },
      ];
    });

    const feed = await queries.activityFeed('u1', 'ws1', true, getCommits);

    expect(feed.warnings).toEqual([
      {
        projectId: 'p1',
        projectName: 'api',
        message: 'Repository activity is unavailable: Gitea is unreachable',
      },
    ]);
    expect(feed.events.map((event) => [event.projectId, event.sha])).toEqual([
      ['p2', 'b'.repeat(40)],
      ['p1', SHA],
    ]);
  });

  it('caches SCM commits between requests', async () => {
    const { queries } = make();
    const getCommits = jest.fn(async () => []);

    await queries.activityFeed('u1', 'ws1', true, getCommits);
    await queries.activityFeed('u1', 'ws1', true, getCommits);

    expect(getCommits).toHaveBeenCalledTimes(2);
  });
});
