export const RATE_LIMIT_POLICY = Symbol('initpad:rate-limit-policy');

export type RateLimitSubject =
  | { source: 'body' | 'query'; field: string; normalization: 'identity' | 'opaque' }
  | { source: 'user'; normalization: 'opaque' };

export interface RateLimitPolicy {
  name: string;
  windowMs: number;
  ipLimit: number;
  subjectLimit?: number;
  subject?: RateLimitSubject;
}

const minute = 60_000;

/**
 * Security limits are explicit per operation. IP limits protect the service;
 * subject limits protect one account/token from attempts distributed across
 * many addresses. Successful and failed attempts consume the same buckets.
 */
export const RATE_LIMITS = {
  register: {
    name: 'auth.register',
    windowMs: 60 * minute,
    ipLimit: 10,
    subjectLimit: 5,
    subject: { source: 'body', field: 'email', normalization: 'identity' },
  },
  signIn: {
    name: 'auth.signin',
    windowMs: 5 * minute,
    ipLimit: 30,
    subjectLimit: 10,
    subject: { source: 'body', field: 'username', normalization: 'identity' },
  },
  changePassword: {
    name: 'auth.change-password',
    windowMs: 15 * minute,
    ipLimit: 20,
    subjectLimit: 5,
    subject: { source: 'user', normalization: 'opaque' },
  },
  requestEmailVerification: {
    name: 'auth.email.request-verification',
    windowMs: 15 * minute,
    ipLimit: 20,
    subjectLimit: 3,
    subject: { source: 'user', normalization: 'opaque' },
  },
  verifyEmail: {
    name: 'auth.email.verify',
    windowMs: 15 * minute,
    ipLimit: 20,
    subjectLimit: 10,
    subject: { source: 'body', field: 'token', normalization: 'opaque' },
  },
  requestPasswordReset: {
    name: 'auth.password.request-reset',
    windowMs: 15 * minute,
    ipLimit: 10,
    subjectLimit: 5,
    subject: { source: 'body', field: 'identity', normalization: 'identity' },
  },
  resetPassword: {
    name: 'auth.password.reset',
    windowMs: 15 * minute,
    ipLimit: 20,
    subjectLimit: 10,
    subject: { source: 'body', field: 'token', normalization: 'opaque' },
  },
  activate: {
    name: 'auth.activate',
    windowMs: 15 * minute,
    ipLimit: 20,
    subjectLimit: 10,
    subject: { source: 'body', field: 'token', normalization: 'opaque' },
  },
  agentEnroll: {
    name: 'agent.enroll',
    windowMs: 10 * minute,
    ipLimit: 10,
    subjectLimit: 5,
    subject: { source: 'body', field: 'token', normalization: 'opaque' },
  },
  githubAuthorize: {
    name: 'auth.github.authorize',
    windowMs: 5 * minute,
    ipLimit: 30,
  },
  githubCallback: {
    name: 'auth.github.callback',
    windowMs: 5 * minute,
    ipLimit: 60,
  },
  githubSetup: {
    name: 'scm.github.setup',
    windowMs: 10 * minute,
    ipLimit: 30,
    subjectLimit: 10,
    subject: { source: 'user', normalization: 'opaque' },
  },
  githubSetupCallback: {
    name: 'scm.github.setup.callback',
    windowMs: 5 * minute,
    ipLimit: 30,
  },
} as const satisfies Record<string, RateLimitPolicy>;
