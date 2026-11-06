// Usernames Gitea refuses (its route and feature names). InitPad creates a Gitea
// account with the same name for every user, so these can never be registered.
// Gitea stays the authority (see GiteaService.createUser); this list only gives a
// clear answer before the round trip.
const RESERVED_USERNAMES = new Set([
  '.well-known',
  'admin',
  'api',
  'assets',
  'attachments',
  'avatar',
  'avatars',
  'captcha',
  'commits',
  'debug',
  'devtools',
  'error',
  'explore',
  'favicon.ico',
  'ghost',
  'issues',
  'login',
  'manifest.json',
  'metrics',
  'milestones',
  'new',
  'notifications',
  'org',
  'pulls',
  'raw',
  'repo',
  'repo-avatars',
  'robots.txt',
  'search',
  'serviceworker.js',
  'ssh_info',
  'swagger.v1.json',
  'user',
  'v2',
]);

export const RESERVED_USERNAME_MESSAGE =
  'This username is reserved (for example "admin"). Choose another one; the first account still becomes the administrator.';

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.trim().toLowerCase());
}
