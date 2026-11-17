import { t } from '@/i18n';

/**
 * Opens GitHub in a centered pop-up. It opens blank first, so the browser
 * accepts it as a reaction to the click, and navigates once the URL is known.
 */
export function openGithubWindow(url?: string): Window | null {
  const width = 760;
  const height = 820;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open(
    'about:blank',
    '_blank',
    `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`,
  );
  if (!popup) return null;
  popup.opener = null;
  popup.document.title = t('Opening GitHub…');
  popup.document.body.textContent = t('Opening GitHub…');
  if (url) popup.location.replace(url);
  popup.focus();
  return popup;
}

/** Reads and clears the `?github=` result GitHub's redirect left on this page. */
export function takeGithubResult(path: string): { result: string; query: URLSearchParams } | null {
  const query = new URLSearchParams(window.location.search);
  const result = query.get('github');
  if (!result) return null;
  window.history.replaceState({}, '', path);
  return { result, query };
}
