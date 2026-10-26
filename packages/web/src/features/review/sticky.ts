import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Where the review page's sticky parts stop (v0.3.0 D-A): its bar sticks under the app's top bar
 * and, in demo mode, the demo banner (sticky too, its height depends on its text); the files'
 * headers stick under the bar. Both heights are measured as they change, so nothing overlaps at
 * any width. The page sets them as CSS variables: `--review-top` for the bar and
 * `--diff-sticky-top` (read by the diff viewer's sticky headers) for the file headers. Without
 * ResizeObserver (jsdom) the defaults hold.
 */
export function useStickyOffsets() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [banner, setBanner] = useState(0);
  const [bar, setBar] = useState<number | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const barEl = barRef.current;
    if (root === null || barEl === null || typeof ResizeObserver === 'undefined') return;
    // The demo banner is a sibling of <main> in the app shell; it may appear after this page.
    const shell = root.closest('main')?.parentElement ?? null;
    const findBanner = () =>
      shell?.querySelector<HTMLElement>(':scope > [data-testid="demo-banner"]') ?? null;
    let watched: HTMLElement | null = null;
    const measure = () => {
      setBar(barEl.getBoundingClientRect().height);
      setBanner(watched?.getBoundingClientRect().height ?? 0);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(barEl);
    const watchBanner = () => {
      const next = findBanner();
      if (next === watched) return;
      if (watched !== null) resize.unobserve(watched);
      watched = next;
      if (watched !== null) resize.observe(watched);
      measure();
    };
    watchBanner();
    const mutations =
      shell !== null && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(watchBanner)
        : null;
    if (shell !== null) mutations?.observe(shell, { childList: true });
    return () => {
      resize.disconnect();
      mutations?.disconnect();
    };
  }, []);

  const style = {
    '--review-top': `calc(var(--spacing-topbar) + ${banner}px)`,
    '--diff-sticky-top':
      bar === null ? 'calc(var(--review-top) + 3rem)' : `calc(var(--review-top) + ${bar}px)`,
  };
  return { rootRef, barRef, style };
}
