import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { config } from '../config';
import { isWorkspaceCheckout, uniqueWorkspaceSubpath, workspacePath } from './generator.service';

describe('workspacePath', () => {
  const root = resolve(config.workspaceDir);

  it('resolves an owner and project below the workspace directory', () => {
    expect(workspacePath('alice/my-app')).toBe(join(root, 'alice', 'my-app'));
    expect(workspacePath('a..b/my-app')).toBe(join(root, 'a..b', 'my-app'));
  });

  it.each(['../escape', 'alice/../../escape', '/etc/passwd', 'alice//app', 'alice/.hidden', ''])(
    'rejects %p',
    (subpath) => {
      expect(() => workspacePath(subpath)).toThrow(/Invalid workspace path/);
    },
  );
});

describe('request-unique checkouts', () => {
  const original = config.workspaceDir;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'initpad-generator-spec-'));
    config.workspaceDir = join(root, 'workspace');
    mkdirSync(config.workspaceDir);
  });

  afterEach(() => {
    config.workspaceDir = original;
    rmSync(root, { recursive: true, force: true });
  });

  it('gives two concurrent creates of the same name separate directories', () => {
    const first = uniqueWorkspaceSubpath('alice', 'my-app');
    const second = uniqueWorkspaceSubpath('alice', 'my-app');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^alice\/my-app-[A-Za-z0-9]{6}$/);
    expect(existsSync(workspacePath(first))).toBe(true);
    expect(existsSync(workspacePath(second))).toBe(true);
  });

  it('recognises only absolute paths strictly inside the workspace', () => {
    expect(isWorkspaceCheckout(join(config.workspaceDir, 'alice', 'app'))).toBe(true);
    expect(isWorkspaceCheckout(config.workspaceDir)).toBe(false);
    expect(isWorkspaceCheckout('alice/app')).toBe(false);
    expect(isWorkspaceCheckout(join(config.workspaceDir, '..', 'api'))).toBe(false);
    expect(isWorkspaceCheckout('')).toBe(false);
  });
});
