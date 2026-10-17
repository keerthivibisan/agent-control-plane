import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach } from 'vitest';

// Animations finish at once, so exits are synchronous and nothing waits on a frame.
MotionGlobalConfig.skipAnimations = true;

// Recharts' ResponsiveContainer observes its parent's size; jsdom has no ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Motion's reduced-motion check and the theme read media queries; jsdom has no matchMedia. Nothing
// matches: light theme, motion allowed (and skipped above).
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// Radix menus and tabs use pointer capture and scroll the focused item into view; jsdom lacks both.
if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
});
