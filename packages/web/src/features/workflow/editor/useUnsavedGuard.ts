import { useEffect } from 'react';

/**
 * Asks before unsaved changes are lost: the browser's own prompt when the tab is closed or
 * reloaded, and a confirm when an in-app link (`href="#/…"`, the sidebar, breadcrumbs, links on
 * the page) would leave the page. Navigation that doesn't go through a link (the ⌘K palette)
 * isn't caught; the editor shows "Unsaved changes" next to Save for that.
 */
export function useUnsavedGuard(dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need a value to show their prompt (the text itself is never shown).
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      const link = target?.closest('a[href]');
      if (link === null || link === undefined) return;
      const to = link.getAttribute('href') ?? '';
      if (!to.startsWith('#') || link.getAttribute('target') === '_blank') return;
      if (to === window.location.hash) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}
