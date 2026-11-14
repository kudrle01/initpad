/** Sign-in address that returns to `location` afterwards (the overview needs no `next`). */
export function loginPath(location: { pathname: string; search: string; hash: string }): string {
  const destination = `${location.pathname}${location.search}${location.hash}`;
  return destination === '/' ? '/login' : `/login?next=${encodeURIComponent(destination)}`;
}
