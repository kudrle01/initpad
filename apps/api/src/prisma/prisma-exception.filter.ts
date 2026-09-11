import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Converts expected database constraint races into stable API semantics.
 * Service-level checks still provide the more specific messages; this is the
 * final boundary for two requests that pass such a check concurrently.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = this.map(exception.code);
    response.status(mapped.status).json({
      statusCode: mapped.status,
      error: mapped.error,
      message: mapped.message,
    });
  }

  private map(code: string): { status: number; error: string; message: string } {
    if (code === 'P2002') {
      return {
        status: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'A record with these values already exists',
      };
    }
    if (code === 'P2003') {
      return {
        status: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'This record is still referenced by another resource',
      };
    }
    if (code === 'P2025') {
      return {
        status: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: 'The requested record no longer exists',
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'A database operation failed',
    };
  }
}
