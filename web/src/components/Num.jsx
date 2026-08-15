/**
 * A live figure.
 *
 * Every number that can change while the user is looking at it goes through
 * this component. It is the anti-jitter contract in one place:
 *   - monospace + `font-variant-numeric: tabular-nums` (all digits equal width,
 *     so 1 -> 8 does not resize the string),
 *   - a reserved `min-width` in `ch` sized for the widest plausible value,
 *   - right alignment, so the number grows leftwards into reserved space
 *     instead of pushing whatever follows it.
 *
 * `w` is a ch-width bucket, not a free number, so the widths stay a small
 * documented set rather than drifting per call site.
 *
 * Widths: 6ch counts/percent · 8ch latency & unit cost · 10ch total cost.
 */
export function Num({ children, w = 6, tone, className = '', ...rest }) {
  const classes = ['num', `num--w${w}`];
  if (tone) classes.push(`tone-${tone}`);
  if (className) classes.push(className);
  return (
    <span className={classes.join(' ')} {...rest}>
      {children}
    </span>
  );
}
