import { EventEmitter } from 'node:events';
import { currentRequestId, newCorrelationId, requestContextMiddleware } from './request-context';
import { structuredLogRecord } from './structured-logger';

describe('request context', () => {
  it('generates an untrusted-request-independent id and returns it in the response', () => {
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      setHeader: jest.Mock;
    };
    response.statusCode = 200;
    response.setHeader = jest.fn();
    let observed: string | undefined;

    requestContextMiddleware({ method: 'GET', originalUrl: '/api/projects' }, response, () => {
      observed = currentRequestId();
      expect(newCorrelationId()).toBe(observed);
      expect(structuredLogRecord('log', 'inside request')).toMatchObject({
        requestId: observed,
      });
    });

    expect(observed).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', observed);
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-InitPad-Instance',
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    );
  });

  it('uses a fresh correlation id outside an HTTP request', () => {
    expect(newCorrelationId()).toMatch(/^[a-f0-9-]{36}$/);
  });
});
