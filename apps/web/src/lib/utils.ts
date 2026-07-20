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
  if (!targetUrl) return undefined;
  if (provider !== 'gitea') return targetUrl;
  try {
    const u = new URL(targetUrl);
    return `${u.origin}/user/login?redirect_to=${encodeURIComponent(u.pathname + u.search)}`;
  } catch {
    return targetUrl;
  }
}
