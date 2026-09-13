import type { LoggerService, LogLevel } from '@nestjs/common';
import { currentRequestId } from './request-context';

type LogWriter = (line: string, level: LogLevel) => void;

const SECRET_KEY =
  /(?:access.?key|api.?key|authorization|cookie|credential|password|private.?key|secret|session|token)/i;
const SECRET_TEXT = [
  /\b(?:initpad_(?:enroll|agent)_[A-Za-z0-9_-]+)\b/g,
  /\b(?:github_pat_|gh[opsu]_|glpat-)[A-Za-z0-9_-]+\b/g,
  /(\bauthorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi,
  /(\b(?:access.?key|api.?key|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi,
  /(\/(?:activate|reset-password|verify-email)\/)[A-Za-z0-9_-]+/gi,
  /(https?:\/\/[^\s:/]+:)[^\s@/]+@/gi,
];

function redactText(value: string): string {
  return SECRET_TEXT.reduce(
    (redacted, pattern, index) =>
      redacted.replace(pattern, index < 2 ? '[REDACTED]' : '$1[REDACTED]'),
    value,
  );
}

function normalize(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === 'string') return redactText(value).slice(0, 8_192);
  if (value === null || ['number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return null;
  if (typeof value === 'symbol') return value.description ?? '[Symbol]';
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...(value.stack ? { stack: redactText(value.stack).slice(0, 16_384) } : {}),
    };
  }
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return '[Circular]';
  if (depth >= 6) return '[Truncated]';
  seen.add(value);
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => normalize(item, seen, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .flatMap(([key, item]) =>
        item === undefined
          ? []
          : [[key, SECRET_KEY.test(key) ? '[REDACTED]' : normalize(item, seen, depth + 1)]],
      ),
  );
}

export function structuredLogRecord(
  level: LogLevel,
  message: unknown,
  optionalParams: unknown[] = [],
): Record<string, unknown> {
  const outputLevel = level === 'log' ? 'info' : level;
  const context =
    typeof optionalParams.at(-1) === 'string' ? String(optionalParams.at(-1)) : undefined;
  const metadata = optionalParams.slice(0, context ? -1 : undefined);
  const normalizedMessage = normalize(message);
  const requestId = currentRequestId();
  return {
    ...(typeof normalizedMessage === 'object' && normalizedMessage !== null
      ? normalizedMessage
      : { message: normalizedMessage }),
    ...(metadata.length ? { metadata: normalize(metadata) } : {}),
    timestamp: new Date().toISOString(),
    level: outputLevel,
    ...(context ? { context: redactText(context) } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function defaultWriter(line: string, level: LogLevel): void {
  const stream = ['error', 'warn', 'fatal'].includes(level) ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

/** JSON logger for machine search while keeping Nest's Logger API unchanged. */
export class StructuredLogger implements LoggerService {
  constructor(private readonly writer: LogWriter = defaultWriter) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams);
  }

  private write(level: LogLevel, message: unknown, optionalParams: unknown[]): void {
    this.writer(JSON.stringify(structuredLogRecord(level, message, optionalParams)), level);
  }
}
