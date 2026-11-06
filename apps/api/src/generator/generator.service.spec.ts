import { join, resolve } from 'path';
import { config } from '../config';
import { workspacePath } from './generator.service';

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
