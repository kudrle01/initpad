import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Joins and merges Tailwind classes (last one wins) — the standard shadcn helper.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Routes only Gitea links through its SSO login page. GitHub private-repository
// URLs must stay untouched: `/user/login` is a Gitea-only route and rewriting a
// GitHub URL to it produces the misleading github.com/user/login/404 flow.
export function scmLink(
  targetUrl: string | null,
  provider: 'gitea' | 'github',
): string | undefined {
  const href = externalHref(targetUrl);
  if (!href || provider !== 'gitea') return href;
  const u = new URL(href);
  return `${u.origin}/user/login?redirect_to=${encodeURIComponent(u.pathname + u.search)}`;
}

// A link target that came from outside the browser, such as a CI status URL any
// repository writer can set. Only absolute http(s) addresses become links, so a
// `javascript:` or `data:` URL never reaches an href.
export function externalHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
}
