/**
 * Seedable RNG (mulberry32).
 *
 * Without a seed this is just Math.random(). With SEED set, every failure roll,
 * latency draw and token count becomes reproducible -- which is what lets the
 * test suite assert on simulated behaviour instead of tolerating flake.
 */
export function createRng(seed = null) {
  let nextFloat;

  if (seed === null || seed === undefined || !Number.isFinite(Number(seed))) {
    nextFloat = () => Math.random();
  } else {
    let state = Number(seed) >>> 0;
    nextFloat = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    next: nextFloat,
    /** Integer in [min, max] inclusive. */
    nextInt(min, max) {
      if (max <= min) return min;
      return min + Math.floor(nextFloat() * (max - min + 1));
    },
    /** True with probability p. p<=0 is never, p>=1 is always. */
    chance(p) {
      if (p <= 0) return false;
      if (p >= 1) return true;
      return nextFloat() < p;
    },
    pick(items) {
      return items[Math.floor(nextFloat() * items.length)];
    },
  };
}
