import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'control-room:theme';

/**
 * Explicit dark/light choice, persisted.
 *
 * The initial value is read from the DOM rather than from storage: the inline
 * script in index.html has already resolved it before first paint, so trusting
 * the attribute keeps React and the pre-paint decision from disagreeing.
 */
export function useTheme() {
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (private mode); the choice just won't persist.
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle };
}
