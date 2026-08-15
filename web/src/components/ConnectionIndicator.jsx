const STATES = {
  connecting: { glyph: '◌', label: 'Connecting', tone: 'idle' }, //  ◌
  live: { glyph: '●', label: 'Live', tone: 'success' }, //  ●
  reconnecting: { glyph: '◍', label: 'Reconnecting', tone: 'warn' }, //  ◍
};

/**
 * Honest connection state.
 *
 * A dashboard whose numbers have quietly stopped updating is worse than one
 * that admits it is offline -- the reader keeps trusting a frozen screen. The
 * EventSource reconnects on its own, so the interesting states are "trying"
 * and "connected", and both are shown rather than hidden behind an optimistic
 * green dot.
 */
export function ConnectionIndicator({ state }) {
  const meta = STATES[state] ?? STATES.connecting;
  return (
    <span className={`conn tone-${meta.tone}`} title={`Event stream: ${meta.label}`}>
      <span className="conn__dot" aria-hidden="true">
        {meta.glyph}
      </span>
      <span className="conn__label">{meta.label}</span>
      <span className="sr-only">{`Event stream ${meta.label}`}</span>
    </span>
  );
}
