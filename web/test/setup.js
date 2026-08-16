import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unmount between tests. Without this, a component that keeps a timer or an
// EventSource open leaks into the next test and produces failures that look
// like race conditions but are just stale trees.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// jsdom implements neither of these, and both are read at module scope by
// hooks in this app.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
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

if (!window.scrollTo) {
  window.scrollTo = () => {};
}
