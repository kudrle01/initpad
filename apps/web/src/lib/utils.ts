import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Spojí a „domerguje" Tailwind třídy (poslední vyhrává) – standardní shadcn helper.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Odkazy do Gitey vede přes /user/login?redirect_to=… – odhlášený dostane login
// stránku (SSO) místo 404 u privátního repa, přihlášený se rovnou prokliká na cíl.
export function giteaLink(targetUrl: string | null): string | undefined {
  if (!targetUrl) return undefined;
  try {
    const u = new URL(targetUrl);
    return `${u.origin}/user/login?redirect_to=${encodeURIComponent(u.pathname + u.search)}`;
  } catch {
    return targetUrl;
  }
}
