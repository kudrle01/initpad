import { AgentEnrollmentController } from '../agents/agent-enrollment.controller';
import { AgentDistributionController } from '../agents/agent-distribution.controller';
import { HealthController } from '../health/health.controller';
import { OidcController } from '../oauth/oidc.controller';
import { CiController } from '../projects/ci.controller';
import { ScmWebhookController } from '../projects/scm-webhook.controller';
import { GitHubAuthController } from '../scm/github/github-auth.controller';
import { GitHubSetupController } from '../scm/github/github-setup.controller';
import { GitHubWebhookController } from '../scm/github/github-webhook.controller';
import { TemplatesController } from '../templates/templates.controller';
import { AuthController } from './auth.controller';
import { PUBLIC_ENDPOINT, type PublicEndpointReason } from './public-endpoint.decorator';
import { RATE_LIMIT_POLICY, RATE_LIMITS } from './rate-limit.policy';

const classReason = (controller: object) =>
  Reflect.getMetadata(PUBLIC_ENDPOINT, controller) as PublicEndpointReason | undefined;

const methodReason = (controller: object, method: string) =>
  Reflect.getMetadata(
    PUBLIC_ENDPOINT,
    (controller as Record<string, unknown>)[method] as object,
  ) as PublicEndpointReason | undefined;

const methodRateLimit = (controller: object, method: string) =>
  Reflect.getMetadata(
    RATE_LIMIT_POLICY,
    (controller as Record<string, unknown>)[method] as object,
  ) as { name: string } | undefined;

describe('public HTTP boundary contract', () => {
  it.each([
    [HealthController, 'health-check'],
    [TemplatesController, 'public-catalog'],
    [CiController, 'ci-token'],
    [ScmWebhookController, 'scm-signature'],
    [GitHubWebhookController, 'scm-signature'],
    [AgentEnrollmentController, 'agent-credential'],
    [AgentDistributionController, 'public-catalog'],
    [OidcController, 'oidc-protocol'],
    [GitHubAuthController, 'authentication'],
  ] as const)('documents the non-session boundary of %s', (controller, reason) => {
    expect(classReason(controller)).toBe(reason);
  });

  it.each([
    ['authConfig'],
    ['register'],
    ['signin'],
    ['verifyEmail'],
    ['requestPasswordReset'],
    ['resetPassword'],
    ['activate'],
    ['logout'],
  ] as const)('keeps AuthController.%s public for the authentication flow', (method) => {
    expect(methodReason(AuthController.prototype, method)).toBe('authentication');
  });

  it('keeps session account operations protected by the global guard', () => {
    expect(methodReason(AuthController.prototype, 'me')).toBeUndefined();
    expect(methodReason(AuthController.prototype, 'changePassword')).toBeUndefined();
    expect(methodReason(AuthController.prototype, 'requestEmailVerification')).toBeUndefined();
  });

  it.each([
    [AuthController.prototype, 'register', RATE_LIMITS.register.name],
    [AuthController.prototype, 'signin', RATE_LIMITS.signIn.name],
    [AuthController.prototype, 'changePassword', RATE_LIMITS.changePassword.name],
    [
      AuthController.prototype,
      'requestEmailVerification',
      RATE_LIMITS.requestEmailVerification.name,
    ],
    [AuthController.prototype, 'verifyEmail', RATE_LIMITS.verifyEmail.name],
    [AuthController.prototype, 'requestPasswordReset', RATE_LIMITS.requestPasswordReset.name],
    [AuthController.prototype, 'resetPassword', RATE_LIMITS.resetPassword.name],
    [AuthController.prototype, 'activate', RATE_LIMITS.activate.name],
    [AgentEnrollmentController.prototype, 'enroll', RATE_LIMITS.agentEnroll.name],
    [GitHubAuthController.prototype, 'authorize', RATE_LIMITS.githubAuthorize.name],
    [GitHubAuthController.prototype, 'callback', RATE_LIMITS.githubCallback.name],
    [GitHubSetupController.prototype, 'start', RATE_LIMITS.githubSetup.name],
    [GitHubSetupController.prototype, 'recover', RATE_LIMITS.githubSetup.name],
    [GitHubSetupController.prototype, 'callback', RATE_LIMITS.githubSetupCallback.name],
  ] as const)('rate-limits %s.%s as %s', (controller, method, policyName) => {
    expect(methodRateLimit(controller, method)?.name).toBe(policyName);
  });

  it('exposes only the signed setup callback, not GitHub installation mutations', () => {
    expect(classReason(GitHubSetupController)).toBeUndefined();
    expect(methodReason(GitHubSetupController.prototype, 'callback')).toBe('authentication');
    expect(methodReason(GitHubSetupController.prototype, 'start')).toBeUndefined();
    expect(methodReason(GitHubSetupController.prototype, 'recover')).toBeUndefined();
  });
});
