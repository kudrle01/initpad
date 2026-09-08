import { AgentEnrollmentController } from '../agents/agent-enrollment.controller';
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

const classReason = (controller: object) =>
  Reflect.getMetadata(PUBLIC_ENDPOINT, controller) as PublicEndpointReason | undefined;

const methodReason = (controller: object, method: string) =>
  Reflect.getMetadata(
    PUBLIC_ENDPOINT,
    (controller as Record<string, unknown>)[method] as object,
  ) as PublicEndpointReason | undefined;

describe('public HTTP boundary contract', () => {
  it.each([
    [HealthController, 'health-check'],
    [TemplatesController, 'public-catalog'],
    [CiController, 'ci-token'],
    [ScmWebhookController, 'scm-signature'],
    [GitHubWebhookController, 'scm-signature'],
    [AgentEnrollmentController, 'agent-credential'],
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

  it('exposes only the signed setup callback, not GitHub installation mutations', () => {
    expect(classReason(GitHubSetupController)).toBeUndefined();
    expect(methodReason(GitHubSetupController.prototype, 'callback')).toBe('authentication');
    expect(methodReason(GitHubSetupController.prototype, 'start')).toBeUndefined();
    expect(methodReason(GitHubSetupController.prototype, 'recover')).toBeUndefined();
  });
});
