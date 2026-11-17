import { HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';
import { ScmExceptionFilter } from './scm-exception.filter';
import { ScmHttpStatusError, ScmHttpTransportError } from './scm-http';

function execute(error: ScmHttpStatusError | ScmHttpTransportError) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  new ScmExceptionFilter().catch(error, host);
  return { status, json };
}

describe('ScmExceptionFilter', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("answers a rejected GitHub call with 502 and GitHub's reason instead of a 500", () => {
    const { status, json } = execute(
      new ScmHttpStatusError(
        'GitHub',
        'grant collaborator access',
        422,
        "Could not grant repository access to 'dev'",
        'Validation Failed - permission is invalid',
      ),
    );
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    expect(json).toHaveBeenCalledWith({
      statusCode: 502,
      error: 'Bad Gateway',
      message:
        "Could not grant repository access to 'dev' (HTTP 422): Validation Failed - permission is invalid",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scm.request_failed',
        operation: 'grant collaborator access',
        upstreamStatus: 422,
        detail: 'Validation Failed - permission is invalid',
      }),
    );
  });

  it("never passes the provider's 401/403 through as the caller's own authorization status", () => {
    const { status } = execute(new ScmHttpStatusError('GitHub', 'delete repository', 403));
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
  });

  it('reports rate limits and provider outages as temporarily unavailable', () => {
    expect(
      execute(new ScmHttpStatusError('GitHub', 'list repositories', 429)).status,
    ).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(
      execute(new ScmHttpStatusError('Gitea', 'list repositories', 503)).status,
    ).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('maps transport failures to gateway errors without connection details', () => {
    const timedOut = execute(new ScmHttpTransportError('GitHub', 'API request', true));
    expect(timedOut.status).toHaveBeenCalledWith(HttpStatus.GATEWAY_TIMEOUT);
    expect(timedOut.json.mock.calls[0][0].message).toBe(
      'GitHub did not answer in time. Try again in a moment.',
    );
    const unreachable = execute(new ScmHttpTransportError('Gitea', 'API request', false));
    expect(unreachable.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    expect(unreachable.json.mock.calls[0][0].message).toBe(
      'Gitea could not be reached. Try again in a moment.',
    );
  });
});
