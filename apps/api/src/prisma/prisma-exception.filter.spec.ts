import { HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

function execute(code: string) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  const error = new Prisma.PrismaClientKnownRequestError('database failure', {
    code,
    clientVersion: '5.22.0',
  });
  new PrismaExceptionFilter().catch(error, host);
  return { status, json };
}

describe('PrismaExceptionFilter', () => {
  it('maps a unique-key race to conflict without exposing database details', () => {
    const { status, json } = execute('P2002');
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      error: 'Conflict',
      message: 'A record with these values already exists',
    });
  });

  it('keeps unknown Prisma failures generic', () => {
    const { status, json } = execute('P2999');
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json.mock.calls[0][0].message).toBe('A database operation failed');
  });
});
