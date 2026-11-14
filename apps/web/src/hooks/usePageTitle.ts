import { useEffect } from 'react';

const PRODUCT = 'InitPad';

/** Names the browser tab after the current page, e.g. "Servers · InitPad". */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · ${PRODUCT}`;
    return () => {
      document.title = PRODUCT;
    };
  }, [title]);
}
