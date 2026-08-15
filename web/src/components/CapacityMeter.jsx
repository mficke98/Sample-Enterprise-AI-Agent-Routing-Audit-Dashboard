/**
 * Concurrency as discrete slots, not a continuous bar.
 *
 * `max_concurrent` is a small integer (2..10), and the question a reader has
 * is "how many slots are left?" -- a countable one. A percentage-filled bar
 * answers a different, vaguer question and hides the difference between 2/3
 * and 2.4/3. So: one 12x6 segment per slot, filled or outlined.
 *
 * At full occupancy the segments switch to the amber priority colour and an
 * `AT CAPACITY` micro-label appears, because saturation is the state that
 * actually predicts queue growth and it should not be a subtle colour shift.
 *
 * The whole strip is a single `role="img"` with one label -- a screen reader
 * should hear "2 of 3 slots in use", not eight anonymous divs.
 */
export function CapacityMeter({ active = 0, max = 0 }) {
  const total = Math.max(0, max);
  const used = Math.min(Math.max(0, active), total);
  const saturated = total > 0 && used >= total;

  return (
    <div className="capacity">
      <div
        className={`capacity__slots${saturated ? ' capacity__slots--full' : ''}`}
        role="img"
        aria-label={`${used} of ${total} slots in use`}
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={`slot${index < used ? ' slot--filled' : ''}`}
            aria-hidden="true"
          />
        ))}
      </div>
      <span className="capacity__label mono" aria-hidden="true">
        {used}/{total}
      </span>
      {saturated ? <span className="capacity__flag">AT CAPACITY</span> : null}
    </div>
  );
}
