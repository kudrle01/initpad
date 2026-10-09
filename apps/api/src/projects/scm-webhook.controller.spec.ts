import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { config } from '../config';
import { ScmWebhookController } from './scm-webhook.controller';

function signedRequest(body: unknown) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac('sha256', config.scm.webhookToken).update(rawBody).digest('hex');
  return { signature, request: { rawBody } as never };
}

describe('ScmWebhookController payload validation', () => {
  const original = config.scm.webhookToken;
  beforeAll(() => {
    config.scm.webhookToken = 'test-webhook-secret';
  });
  afterAll(() => {
    config.scm.webhookToken = original;
  });

  it('removes the project of a deleted Gitea repository', () => {
    const projects = { removeIfRepositoryGone: jest.fn(async () => undefined) };
    const controller = new ScmWebhookController(projects as never);
    const body = { action: 'deleted', repository: { id: 7, full_name: 'alice/app' } };
    const { signature, request } = signedRequest(body);

    expect(controller.handle('', signature, 'repository', request, body)).toEqual({
      accepted: true,
    });
    expect(projects.removeIfRepositoryGone).toHaveBeenCalledWith('alice/app', 'gitea', '7');
  });

  it('rejects a signed payload whose repository name is not a string', () => {
    const projects = { removeIfRepositoryGone: jest.fn() };
    const controller = new ScmWebhookController(projects as never);
    const body = { action: 'deleted', repository: { full_name: { contains: '' } } };
    const { signature, request } = signedRequest(body);

    expect(() => controller.handle('', signature, 'repository', request, body)).toThrow(
      BadRequestException,
    );
    expect(projects.removeIfRepositoryGone).not.toHaveBeenCalled();
  });
});
