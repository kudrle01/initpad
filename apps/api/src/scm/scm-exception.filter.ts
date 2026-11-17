import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ScmHttpStatusError, ScmHttpTransportError } from './scm-http';

/**
 * Answers a request that failed because GitHub or Gitea rejected or did not
 * answer an upstream call. Without this boundary such errors became a generic
 * 500 and the provider's reason was lost. The upstream status is never passed
 * through: a 401/403/404 from the provider describes the platform's App or
 * token, not the caller's own authorization, so the caller gets a gateway
 * status with the provider's sanitized explanation instead.
 */
@Catch(ScmHttpStatusError, ScmHttpTransportError)
export class ScmExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ScmExceptionFilter');

  catch(exception: ScmHttpStatusError | ScmHttpTransportError, host: ArgumentsHost): void {
    const mapped = map(exception);
    this.logger.warn({
      event: 'scm.request_failed',
      provider: exception.provider,
      operation: exception.operation,
      ...(exception instanceof ScmHttpStatusError
        ? { upstreamStatus: exception.status, detail: exception.detail ?? null }
        : { timedOut: exception.timedOut }),
      status: mapped.status,
    });
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(mapped.status)
      .json({ statusCode: mapped.status, error: mapped.error, message: mapped.message });
  }
}

function map(exception: ScmHttpStatusError | ScmHttpTransportError): {
  status: number;
  error: string;
  message: string;
} {
  if (exception instanceof ScmHttpTransportError) {
    return exception.timedOut
      ? {
          status: HttpStatus.GATEWAY_TIMEOUT,
          error: 'Gateway Timeout',
          message: `${exception.provider} did not answer in time. Try again in a moment.`,
        }
      : {
          status: HttpStatus.BAD_GATEWAY,
          error: 'Bad Gateway',
          message: `${exception.provider} could not be reached. Try again in a moment.`,
        };
  }
  if (exception.kind === 'rate-limit' || exception.kind === 'unavailable') {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message: exception.message,
    };
  }
  return { status: HttpStatus.BAD_GATEWAY, error: 'Bad Gateway', message: exception.message };
}
