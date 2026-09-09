export type ScmHttpProvider = 'Gitea' | 'GitHub';

export type ScmHttpFailureKind =
  | 'authentication'
  | 'permission'
  | 'not-found'
  | 'conflict'
  | 'rate-limit'
  | 'unavailable'
  | 'request';

const DEFAULT_TIMEOUT_MS = 15_000;
export const SCM_DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
export const SCM_MAX_PAGES = 100;

export class ScmHttpStatusError extends Error {
  readonly retryable: boolean;
  readonly kind: ScmHttpFailureKind;

  constructor(
    readonly provider: ScmHttpProvider,
    readonly operation: string,
    readonly status: number,
    message?: string,
  ) {
    super(`${message ?? `${provider} ${operation} failed`} (HTTP ${status})`);
    this.name = 'ScmHttpStatusError';
    this.kind = failureKind(status);
    this.retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

export class ScmHttpTransportError extends Error {
  constructor(
    readonly provider: ScmHttpProvider,
    readonly operation: string,
    readonly timedOut: boolean,
  ) {
    super(`${provider} ${operation} ${timedOut ? 'timed out' : 'request failed'}`);
    this.name = 'ScmHttpTransportError';
  }
}

/**
 * Executes one bounded SCM request. It deliberately does not retry: callers
 * know whether their provider-specific operation is safe to repeat. Transport
 * errors never include the URL, headers or upstream body, which may contain
 * repository credentials or OAuth material.
 */
export async function scmFetch(
  provider: ScmHttpProvider,
  operation: string,
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('SCM request timeout must be a positive integer');
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  try {
    return await fetch(input, { ...init, signal });
  } catch {
    throw new ScmHttpTransportError(provider, operation, timeoutSignal.aborted);
  }
}

/** Creates a structured, body-free HTTP error while preserving safe wording. */
export function scmStatusError(
  provider: ScmHttpProvider,
  operation: string,
  response: Pick<Response, 'status'>,
  message?: string,
): ScmHttpStatusError {
  return new ScmHttpStatusError(provider, operation, response.status, message);
}

/** Collects finite page-based APIs and fails instead of silently truncating. */
export async function collectScmPages<T>(options: {
  provider: ScmHttpProvider;
  operation: string;
  pageSize: number;
  load: (page: number) => Promise<readonly T[]>;
  maxPages?: number;
}): Promise<T[]> {
  const result: T[] = [];
  const maxPages = options.maxPages ?? SCM_MAX_PAGES;
  assertPagination(options.pageSize, maxPages);
  for (let page = 1; page <= maxPages; page += 1) {
    const items = await options.load(page);
    result.push(...items);
    if (items.length < options.pageSize) return result;
  }
  throw new Error(`${options.provider} ${options.operation} exceeded the pagination limit`);
}

/** Scans finite page-based APIs and stops as soon as a provider match is found. */
export async function findInScmPages<T, R>(options: {
  provider: ScmHttpProvider;
  operation: string;
  pageSize: number;
  load: (page: number) => Promise<readonly T[]>;
  find: (items: readonly T[]) => R | undefined;
  maxPages?: number;
}): Promise<R | null> {
  const maxPages = options.maxPages ?? SCM_MAX_PAGES;
  assertPagination(options.pageSize, maxPages);
  for (let page = 1; page <= maxPages; page += 1) {
    const items = await options.load(page);
    const match = options.find(items);
    if (match !== undefined) return match;
    if (items.length < options.pageSize) return null;
  }
  throw new Error(`${options.provider} ${options.operation} exceeded the pagination limit`);
}

function assertPagination(pageSize: number, maxPages: number): void {
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize <= 0 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages <= 0
  ) {
    throw new Error('SCM pagination limits must be positive integers');
  }
}

function failureKind(status: number): ScmHttpFailureKind {
  if (status === 401) return 'authentication';
  if (status === 403) return 'permission';
  if (status === 404) return 'not-found';
  if (status === 409 || status === 422) return 'conflict';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'unavailable';
  return 'request';
}
