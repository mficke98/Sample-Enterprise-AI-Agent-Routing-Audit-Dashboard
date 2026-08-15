import { useEffect, useRef, useState } from 'react';

/** Never announce more often than this, no matter how fast the stream runs. */
const ANNOUNCE_INTERVAL_MS = 5000;

/**
 * A screen-reader summary that stays useful under load.
 *
 * The stream itself is `aria-live="off"` on purpose: a busy console appends
 * several rows a second, and announcing each one turns a screen reader into a
 * denial-of-service against its own user. Instead this hook samples the
 * aggregate every 5 seconds and emits ONE sentence describing the delta -- the
 * information a listener actually wants ("three completed, one fell back")
 * without the firehose.
 *
 * Returns the string to place in a visually-hidden role="status" node.
 */
export function useCoalescedAnnouncer(metrics) {
  const [message, setMessage] = useState('');

  // Latest metrics, read by the timer without making it a dependency (which
  // would reset the interval on every single metrics frame).
  const latest = useRef(metrics);
  latest.current = metrics;

  // Last announced counts, so we can describe the change rather than restate
  // the world every five seconds.
  const previous = useRef(null);

  // Flips each announcement. Two consecutive identical strings can be
  // swallowed as "no change" by a live region, so we alternate a trailing
  // space -- inaudible, but enough to make the node's text genuinely new.
  const parity = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const current = latest.current;
      if (!current) return;

      const snapshot = {
        completed: current.totals?.completed ?? 0,
        failed: current.totals?.failed ?? 0,
        pending: current.totals?.pending ?? 0,
        processing: current.totals?.processing ?? 0,
        fallbacks: current.fallback?.count ?? 0,
      };

      const before = previous.current;
      previous.current = snapshot;
      if (!before) return; // First sample establishes the baseline only.

      const parts = [];
      const delta = (key) => snapshot[key] - before[key];
      if (delta('completed') > 0) parts.push(`${delta('completed')} completed`);
      if (delta('failed') > 0) parts.push(`${delta('failed')} failed`);
      if (delta('fallbacks') > 0) parts.push(`${delta('fallbacks')} re-routed to fallback`);
      if (parts.length === 0) return; // Nothing changed: stay silent.

      parts.push(`${snapshot.processing} processing, ${snapshot.pending} pending`);
      parity.current = !parity.current;
      setMessage(`${parts.join(', ')}.${parity.current ? ' ' : ''}`);
    }, ANNOUNCE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return message;
}
