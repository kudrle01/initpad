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
    /** The provider's own validation text, sanitized by `readProviderErrorDetail`. */
    readonly detail?: string,
  ) {
    super(
      `${message ?? `${provider} ${operation} failed`} (HTTP ${status})${detail ? `: ${detail}` : ''}`,
    );
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
 * The requested repository name is already taken by an existing repository
 * that this provisioning did not create. Nothing external was changed, so the
 * failure must never be "cleaned up" by deleting that repository.
 */
export class ScmRepositoryExistsError extends Error {
  constructor(
    readonly provider: ScmHttpProvider,
    readonly fullName: string,
  ) {
    super(`A repository named '${fullName}' already exists in ${provider}`);
    this.name = 'ScmRepositoryExistsError';
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
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  try {
    return await fetch(input, { ...init, signal });
  } catch {
    throw new ScmHttpTransportError(provider, operation, timeoutSignal.aborted);
  }
}

/** True when the provider reported that the addressed resource does not exist. */
export function isScmNotFound(error: unknown): boolean {
  return error instanceof ScmHttpStatusError && error.kind === 'not-found';
}

/** Creates a structured, body-free HTTP error while preserving safe wording. */
export function scmStatusError(
  provider: ScmHttpProvider,
  operation: string,
  response: Pick<Response, 'status'>,
  message?: string,
  detail?: string,
): ScmHttpStatusError {
  return new ScmHttpStatusError(provider, operation, response.status, message, detail);
}

const MAX_DETAIL_LENGTH = 200;

/**
 * Reads the provider's explanation of a rejected request, such as GitHub's
 * "Validation Failed" with its `errors[]`, so an operator can see why a call
 * failed. Only `message` and the per-error `message`/`code` strings are kept,
 * as one line without URLs, so a body can never smuggle a link, a header or
 * an unbounded payload into logs or API responses. A body that is missing or
 * not JSON yields no detail.
 */
export async function readProviderErrorDetail(response: unknown): Promise<string | undefined> {
  const json = (response as { json?: unknown } | null)?.json;
  if (typeof json !== 'function') return undefined;
  let body: unknown;
  try {
    body = await (json as () => Promise<unknown>).call(response);
  } catch {
    return undefined;
  }
  if (!body || typeof body !== 'object') return undefined;
  const { message, errors } = body as { message?: unknown; errors?: unknown };
  const parts: string[] = [];
  if (typeof message === 'string') parts.push(message);
  if (Array.isArray(errors)) {
    for (const entry of errors.slice(0, 3)) {
      if (typeof entry === 'string') parts.push(entry);
      else if (entry && typeof entry === 'object') {
        const { message: text, code } = entry as { message?: unknown; code?: unknown };
        if (typeof text === 'string') parts.push(text);
        else if (typeof code === 'string') parts.push(code);
      }
    }
  }
  const detail = parts
    .join(' - ')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DETAIL_LENGTH);
  return detail || undefined;
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
