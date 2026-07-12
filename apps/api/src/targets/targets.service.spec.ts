import { TargetsService, TargetRow } from './targets.service';
import { encryptSecret } from '../common/secret';

// parseCaps and connectionForTarget are pure — no Prisma/Deployment needed.
const svc = new TargetsService({} as never, {} as never);

describe('parseCaps', () => {
  it('splits, trims and drops empty entries', () => {
    expect(svc.parseCaps('static, php , ,node')).toEqual(['static', 'php', 'node']);
  });
  it('returns [] for an empty string', () => {
    expect(svc.parseCaps('')).toEqual([]);
  });
});

describe('connectionForTarget', () => {
  const base: TargetRow = {
    id: 't1',
    name: 'ESO',
    kind: 'sftp',
    scope: 'user',
    capabilities: 'static,php',
    host: 'eso.example.edu',
    port: 22,
    username: 'kudj05',
    auth: 'password',
    secret: encryptSecret('pw'),
    remotePath: '/www',
    publicUrl: 'https://eso.example.edu/~kudj05',
    verifiedAt: null,
    ownerId: 'u1',
    createdAt: new Date(),
  };

  it('returns undefined for a built-in target (uses config demo path)', () => {
    expect(svc.connectionForTarget({ ...base, scope: 'builtin' })).toBeUndefined();
  });

  it('builds a password connection for a user target', () => {
    const c = svc.connectionForTarget(base)!;
    expect(c.host).toBe('eso.example.edu');
    expect(c.password).toBe('pw');
    expect(c.privateKey).toBeUndefined();
    expect(c.remoteRoot).toBe('/www');
    expect(c.publicUrl).toBe('https://eso.example.edu/~kudj05');
  });

  it('uses a private key when auth is "key"', () => {
    const c = svc.connectionForTarget({ ...base, auth: 'key', secret: encryptSecret('PEMKEY') })!;
    expect(c.privateKey).toBe('PEMKEY');
    expect(c.password).toBeUndefined();
  });
});
