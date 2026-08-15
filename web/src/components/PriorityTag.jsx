import { metaFor, PRIORITY_META } from '../lib/constants.js';

/**
 * Priority as a countable glyph stack: HIGH ▲▲▲ / MEDIUM ▲▲ / LOW ▲.
 *
 * Counting triangles works in grayscale and at a glance, which a colour swatch
 * does not. The word is kept alongside for screen readers and for anyone who
 * would rather read than count.
 */
export function PriorityTag({ value }) {
  const meta = metaFor(PRIORITY_META, value);
  const high = value === 'HIGH';
  return (
    <span className={`prio${high ? ' prio--high' : ''}`} title={`Priority: ${meta.label}`}>
      <span className="prio__glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      <span className="sr-only">{`Priority ${meta.label}`}</span>
    </span>
  );
}
