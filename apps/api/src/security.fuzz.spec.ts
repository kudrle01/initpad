import fc from 'fast-check';
import { createHmac } from 'crypto';
import { relative, resolve, isAbsolute } from 'path';
import { config } from './config';
import { artifactObjectKey } from './artifacts/artifact-store';
import { workspacePath } from './generator/generator.service';
import { GitHubOAuthService } from './scm/github/github-oauth.service';
import { allocationUsageDefaults } from './targets/target-allocation-defaults';

// Property-based fuzzing of the functions that turn request data into paths,
// object keys and authentication decisions. Each property must hold for every
// generated input, including the hostile shapes listed in `hostile`.
const hostile = fc.oneof(
  fc.string(),
  fc.string({ unit: fc.constantFrom('.', '-', '/', '\\', '\0', 'a', '%', ' ') }),
  fc.constantFrom('..', '../..', '/etc/passwd', 'a/../../b', '.\\..\\x', 'a/./b', '‮', ''),
);

describe('security properties (fuzz)', () => {
  it('workspacePath never resolves outside the workspace directory', () => {
    const root = resolve(config.workspaceDir);
    fc.assert(
      fc.property(
        fc.oneof(
          hostile,
          fc.array(hostile).map((parts) => parts.join('/')),
        ),
        (input) => {
          let path: string;
          try {
            path = workspacePath(input);
          } catch (error) {
            expect((error as Error).message).toMatch(/Invalid workspace path/);
            return;
          }
          const rel = relative(root, path);
          expect(rel === '' || rel.startsWith('..') || isAbsolute(rel)).toBe(false);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('artifact object keys contain only safe, non-traversing components', () => {
    fc.assert(
      fc.property(hostile, hostile, hostile, hostile, (workspaceId, projectId, artifactId, d) => {
        let key: string;
        try {
          key = artifactObjectKey({ workspaceId, projectId, artifactId, digest: `sha256:${d}` });
        } catch (error) {
          expect((error as Error).message).toMatch(/artifactObjectKey/);
          return;
        }
        const parts = key.split('/');
        expect(parts[0]).toBe('artifacts');
        expect(parts).toHaveLength(5);
        for (const part of parts) {
          expect(part).toMatch(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/);
          expect(part).not.toContain('..');
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('allocation paths append exactly one namespace segment', () => {
    fc.assert(
      fc.property(hostile, fc.stringMatching(/^[a-z0-9-]{1,20}$/), (remotePath, namespace) => {
        const { rootPath } = allocationUsageDefaults(
          { scope: 'builtin', remotePath, publicUrl: null },
          namespace,
        );
        // An unset path stays unset; there is nothing to namespace.
        if (!remotePath) return expect(rootPath).toBeNull();
        expect(rootPath?.endsWith(`/${namespace}`)).toBe(true);
        expect(rootPath?.slice(0, -namespace.length - 1)).not.toMatch(/\/$/);
      }),
      { numRuns: 2000 },
    );
  });

  it('OAuth state verification rejects any forged or malformed state without throwing', async () => {
    const prisma = { externalOAuthState: { updateMany: jest.fn(async () => ({ count: 1 })) } };
    const service = new GitHubOAuthService(prisma as never);
    const forged = fc
      .record({
        mode: fc.oneof(fc.constantFrom('login', 'link', 'setup'), fc.string()),
        nonce: fc.string(),
        ts: fc.oneof(fc.integer(), fc.double(), fc.constant(Date.now())),
      })
      .map((data) => Buffer.from(JSON.stringify(data)).toString('base64url'));
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          hostile,
          forged.map((payload) => `${payload}.${'A'.repeat(43)}`),
          fc.array(fc.string()) as fc.Arbitrary<unknown>,
        ),
        fc.oneof(fc.string(), fc.constant(undefined)),
        async (state, nonce) => {
          await expect(service.verifyState(state as string, nonce)).resolves.toBeNull();
        },
      ),
      { numRuns: 1000 },
    );
    // Sanity check: the property is not vacuous, a correctly signed state passes.
    const payload = Buffer.from(
      JSON.stringify({ mode: 'login', nonce: 'n'.repeat(16), ts: Date.now() }),
    ).toString('base64url');
    const sig = createHmac('sha256', config.auth.jwtSecret).update(payload).digest('base64url');
    await expect(service.verifyState(`${payload}.${sig}`, 'n'.repeat(16))).resolves.toEqual({
      mode: 'login',
      nonce: 'n'.repeat(16),
    });
  });
});
