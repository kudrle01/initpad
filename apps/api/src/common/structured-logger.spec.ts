import { StructuredLogger, structuredLogRecord } from './structured-logger';

describe('StructuredLogger', () => {
  it('emits one JSON object with an event and Nest context', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger((line) => lines.push(line));
    logger.log({ event: 'deployment.started', operationId: 'operation-1' }, 'Deployments');

    expect(JSON.parse(lines[0])).toMatchObject({
      level: 'info',
      context: 'Deployments',
      event: 'deployment.started',
      operationId: 'operation-1',
    });
  });

  it('redacts secret keys, credentials in URLs and known token formats', () => {
    const record = structuredLogRecord('error', {
      event: 'request.failed',
      password: 'do-not-log',
      nested: { authorization: 'Bearer abc' },
      message:
        'Authorization: Bearer bearer-value token=plain initpad_enroll_abc123 github_pat_abcdef https://app.test/reset-password/reset-value https://alice:password@example.test',
    });
    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain('do-not-log');
    expect(serialized).not.toContain('Bearer abc');
    expect(serialized).not.toContain('bearer-value');
    expect(serialized).not.toContain('initpad_enroll_abc123');
    expect(serialized).not.toContain('github_pat_abcdef');
    expect(serialized).not.toContain('reset-value');
    expect(serialized).not.toContain('alice:password');
    expect(serialized).toContain('[REDACTED]');
  });

  it('bounds recursive and circular values', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(structuredLogRecord('debug', circular)).toMatchObject({ self: '[Circular]' });
  });

  it('does not let message metadata replace reserved log fields', () => {
    expect(
      structuredLogRecord('warn', {
        event: 'malicious.input',
        level: 'success',
        timestamp: 'not-a-time',
      }),
    ).toMatchObject({ event: 'malicious.input', level: 'warn' });
  });
});
