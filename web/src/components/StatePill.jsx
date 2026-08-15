import { metaFor } from '../lib/constants.js';

/**
 * A status pill: glyph + word + colour, never colour alone.
 *
 * The pill has a fixed `min-width` (11ch, wide enough for PROCESSING) so that
 * an agent flipping IDLE -> PROCESSING -> ERROR causes exactly zero reflow in
 * the row around it. Without that, every state change nudges the neighbouring
 * columns and the whole board twitches.
 */
export function StatePill({ table, value, className = '' }) {
  const meta = metaFor(table, value);
  return (
    <span className={`pill tone-${meta.tone} ${className}`.trim()}>
      <span className="pill__glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      <span className="pill__label">{meta.label}</span>
    </span>
  );
}
