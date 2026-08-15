import { useEffect, useState } from 'react';

/**
 * Reactive media query.
 *
 * Used for the one layout decision CSS cannot make on its own: the task form
 * collapses into a <details> on mobile, and that element's open/closed state
 * lives in the DOM, not in a stylesheet.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
