import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

export const PRIVATE_APP_DIR = '.initpad-app';
export const PRIVATE_PROBE = '.initpad-private-probe';

const PUBLIC_HTACCESS = `DirectoryIndex index.php
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.php [L]
</IfModule>
`;

export const PRIVATE_HTACCESS = `<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
</IfModule>
`;

/**
 * Builds the tree uploaded to an Apache-style shared host:
 *
 *   published/              public URL root
 *     index.php             tiny wrapper into the tested front controller
 *     assets...
 *     .initpad-app/         complete immutable application (HTTP denied)
 *
 * The original front controller remains byte-for-byte inside the tested app
 * tree, so its relative vendor/bootstrap paths continue to work for existing
 * as well as newly scaffolded projects.
 */
export function prepareProtectedWebLayout(
  appRoot: string,
  workRoot: string,
  webRoot: string,
): string {
  const normalized = webRoot.replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`Invalid template web root '${webRoot}'`);
  }
  const publicSource = join(appRoot, normalized);
  if (!existsSync(publicSource) || !statSync(publicSource).isDirectory()) {
    throw new Error(`Template web root '${normalized}' is missing from the tested artifact`);
  }

  const published = join(workRoot, 'published');
  const privateRoot = join(published, PRIVATE_APP_DIR);
  rmSync(published, { recursive: true, force: true });
  mkdirSync(published, { recursive: true });
  cpSync(appRoot, privateRoot, { recursive: true });

  for (const entry of readdirSync(publicSource)) {
    cpSync(join(publicSource, entry), join(published, entry), { recursive: true });
  }
  // The wrapper includes the original, CI-tested front controller in its
  // original directory. `__DIR__` inside that file therefore still resolves
  // against <private app>/<www|public>, preserving all relative paths.
  writeFileSync(
    join(published, 'index.php'),
    `<?php\n\nreturn require __DIR__ . '/${PRIVATE_APP_DIR}/${normalized}/index.php';\n`,
    'utf8',
  );
  writeFileSync(join(published, '.htaccess'), PUBLIC_HTACCESS, 'utf8');
  writeFileSync(join(privateRoot, '.htaccess'), PRIVATE_HTACCESS, 'utf8');
  writeFileSync(join(privateRoot, PRIVATE_PROBE), 'initpad', 'utf8');
  return published;
}
