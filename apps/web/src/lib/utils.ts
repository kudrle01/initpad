import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Joins and merges Tailwind classes (last one wins) — the standard shadcn helper.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Routes Gitea links through /user/login?redirect_to=… — a signed-out user
// gets the (SSO) login page instead of a 404 on a private repo; a signed-in
// user clicks straight through to the target.
export function giteaLink(targetUrl: string | null): string | undefined {
  if (!targetUrl) return undefined;
  try {
    const u = new URL(targetUrl);
    return `${u.origin}/user/login?redirect_to=${encodeURIComponent(u.pathname + u.search)}`;
  } catch {
    return targetUrl;
  }
}
