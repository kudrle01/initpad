import { ProjectQueries } from './project-queries';

describe('ProjectQueries SCM load', () => {
  it('requests only the five commits that can appear in workspace activity', async () => {
    const prisma = {
      project: {
        findMany: jest.fn(async () => [
          { id: 'p1', name: 'api' },
          { id: 'p2', name: 'web' },
        ]),
      },
    };
    const workspaces = { resolve: jest.fn(async () => ({ id: 'ws1' })) };
    const getCommits = jest.fn(async () => []);
    const queries = new ProjectQueries(
      prisma as never,
      {} as never,
      {} as never,
      workspaces as never,
    );

    await expect(queries.activity('u1', 'ws1', getCommits)).resolves.toEqual([]);

    expect(getCommits).toHaveBeenNthCalledWith(1, 'p1', 5);
    expect(getCommits).toHaveBeenNthCalledWith(2, 'p2', 5);
  });
});
