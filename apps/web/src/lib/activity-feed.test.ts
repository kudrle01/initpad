// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('activity feed contract', () => {
  it('reads events and warnings from the feed endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(200, {
        events: [{ projectId: 'p1', sha: 'abc' }],
        warnings: [
          {
            projectId: 'p2',
            projectName: 'shop',
            message: 'Repository activity is unavailable: x',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const feed = await api.getActivityFeed();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/activity/feed?scm=true');
    expect(feed.events).toHaveLength(1);
    expect(feed.warnings[0].projectName).toBe('shop');
  });

  it('falls back to the older activity endpoint on 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(404, { message: 'Cannot GET /activity/feed' }))
      .mockResolvedValueOnce(response(200, [{ projectId: 'p1', sha: 'abc' }]));
    vi.stubGlobal('fetch', fetchMock);
    const feed = await api.getActivityFeed();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/activity');
    expect(feed).toEqual({ events: [{ projectId: 'p1', sha: 'abc' }], warnings: [] });
  });
});
