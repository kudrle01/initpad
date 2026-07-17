import { OidcController } from './oidc.controller';

function response() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    redirect: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

const authorizeQuery = {
  response_type: 'code',
  client_id: 'gitea',
  redirect_uri: 'https://git.example.test/user/oauth2/initpad/callback',
  state: 'state-1',
  nonce: 'nonce-1',
};

describe('OidcController account lifecycle enforcement', () => {
  it('issues a code only for the current active session generation', async () => {
    const oidc = {
      isKnownClient: jest.fn(() => true),
      isAllowedRedirect: jest.fn(() => true),
      issueCode: jest.fn(() => 'code-1'),
    };
    const jwt = { verify: jest.fn(() => ({ sub: 'u1', ver: 4 })) };
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1', active: true, mustChangePassword: false, tokenVersion: 4,
        })),
      },
    };
    const res = response();
    const controller = new OidcController(oidc as never, jwt as never, prisma as never);

    await controller.authorize(
      authorizeQuery,
      { cookies: { initpad_token: 'session' } } as never,
      res as never,
    );

    expect(oidc.issueCode).toHaveBeenCalledWith({
      userId: 'u1',
      tokenVersion: 4,
      clientId: 'gitea',
      redirectUri: authorizeQuery.redirect_uri,
      nonce: 'nonce-1',
    });
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('code=code-1'));
  });

  it('does not let a revoked cookie start Gitea SSO', async () => {
    const oidc = {
      isKnownClient: jest.fn(() => true),
      isAllowedRedirect: jest.fn(() => true),
      issueCode: jest.fn(),
    };
    const jwt = { verify: jest.fn(() => ({ sub: 'u1', ver: 3 })) };
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1', active: true, mustChangePassword: false, tokenVersion: 4,
        })),
      },
    };
    const res = response();
    const controller = new OidcController(oidc as never, jwt as never, prisma as never);

    await controller.authorize(
      authorizeQuery,
      { cookies: { initpad_token: 'stale-session' } } as never,
      res as never,
    );

    expect(oidc.issueCode).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/login?next='));
  });

  it('rejects a code when the account changes before token exchange', async () => {
    const oidc = {
      validateClient: jest.fn(() => true),
      consumeCode: jest.fn(() => ({
        userId: 'u1', tokenVersion: 2, clientId: 'gitea',
        redirectUri: authorizeQuery.redirect_uri,
      })),
      issueAccessToken: jest.fn(),
      signIdToken: jest.fn(),
    };
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1', active: true, mustChangePassword: false, tokenVersion: 3,
        })),
      },
    };
    const res = response();
    const controller = new OidcController(oidc as never, {} as never, prisma as never);

    await controller.token(
      {
        grant_type: 'authorization_code', code: 'code-1',
        client_id: 'gitea', client_secret: 'secret',
        redirect_uri: authorizeQuery.redirect_uri,
      },
      { headers: {} } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_grant' });
    expect(oidc.issueAccessToken).not.toHaveBeenCalled();
  });

  it('propagates the real e-mail verification state into the ID token', async () => {
    const oidc = {
      validateClient: jest.fn(() => true),
      consumeCode: jest.fn(() => ({
        userId: 'u1', tokenVersion: 2, clientId: 'gitea',
        redirectUri: authorizeQuery.redirect_uri, nonce: 'nonce-1',
      })),
      issueAccessToken: jest.fn(() => 'access-1'),
      signIdToken: jest.fn(() => 'id-1'),
    };
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1', username: 'alice', name: null, email: 'alice@example.test',
          emailVerifiedAt: null, active: true, mustChangePassword: false, tokenVersion: 2,
        })),
      },
    };
    const res = response();
    const controller = new OidcController(oidc as never, {} as never, prisma as never);

    await controller.token(
      {
        grant_type: 'authorization_code', code: 'code-1',
        client_id: 'gitea', client_secret: 'secret',
        redirect_uri: authorizeQuery.redirect_uri,
      },
      { headers: {} } as never,
      res as never,
    );

    expect(oidc.issueAccessToken).toHaveBeenCalledWith('u1', 2);
    expect(oidc.signIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ email_verified: false }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id_token: 'id-1' }));
  });

  it('revokes an OIDC access token when the account generation changes', async () => {
    const oidc = { accessForToken: jest.fn(() => ({ userId: 'u1', tokenVersion: 1 })) };
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1', active: true, mustChangePassword: false, tokenVersion: 2,
        })),
      },
    };
    const res = response();
    const controller = new OidcController(oidc as never, {} as never, prisma as never);

    await controller.userinfo(
      { headers: { authorization: 'Bearer access-1' } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_token' });
  });
});
