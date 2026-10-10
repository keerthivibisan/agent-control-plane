import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Recharts' ResponsiveContainer observes its parent's size; jsdom has no ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
});
