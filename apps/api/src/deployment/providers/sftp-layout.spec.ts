import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { prepareProtectedWebLayout, PRIVATE_APP_DIR, PRIVATE_PROBE } from './sftp-layout';

describe('prepareProtectedWebLayout', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'initpad-layout-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('publishes only web files and keeps the tested application in a denied directory', () => {
    const app = join(root, 'app');
    mkdirSync(join(app, 'www', 'assets'), { recursive: true });
    mkdirSync(join(app, 'config'), { recursive: true });
    writeFileSync(join(app, 'www', 'index.php'), '<?php echo "tested";');
    writeFileSync(join(app, 'www', 'assets', 'app.css'), 'body{}');
    writeFileSync(join(app, 'config', 'common.neon'), 'secret: value');

    const published = prepareProtectedWebLayout(app, root, 'www');

    expect(readFileSync(join(published, 'index.php'), 'utf8')).toContain(
      "require __DIR__ . '/.initpad-app/www/index.php'",
    );
    expect(readFileSync(join(published, 'index.php'), 'utf8')).toContain('umask(0000);');
    expect(readFileSync(join(published, 'assets', 'app.css'), 'utf8')).toBe('body{}');
    expect(existsSync(join(published, 'config'))).toBe(false);
    expect(readFileSync(join(published, PRIVATE_APP_DIR, 'www', 'index.php'), 'utf8')).toBe(
      '<?php echo "tested";',
    );
    expect(readFileSync(join(published, PRIVATE_APP_DIR, 'config', 'common.neon'), 'utf8')).toBe(
      'secret: value',
    );
    expect(readFileSync(join(published, PRIVATE_APP_DIR, '.htaccess'), 'utf8')).toContain(
      'Require all denied',
    );
    expect(readFileSync(join(published, PRIVATE_APP_DIR, PRIVATE_PROBE), 'utf8')).toBe('initpad');
  });

  it('rejects a missing or traversing web root', () => {
    const app = join(root, 'app');
    mkdirSync(app);
    expect(() => prepareProtectedWebLayout(app, root, '../public')).toThrow('Invalid template web root');
    expect(() => prepareProtectedWebLayout(app, root, 'public')).toThrow('is missing');
  });
});
