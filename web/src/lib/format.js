/**
 * Formatters for live figures.
 *
 * Two rules govern everything in this file, both aimed at the same problem:
 * a number that changes twice a second must never move the layout.
 *
 *  1. UNITS ARE FIXED. Latency is always `ms`, never promoted to `s` at some
 *     threshold. USD is always four decimal places, never trimmed. A unit that
 *     changes at runtime changes the string width, which reflows the row.
 *  2. MISSING IS A DASH, NOT A ZERO AND NEVER `NaN`. An empty system has no
 *     average latency; printing `0 ms` would be a lie and printing `NaN` would
 *     be a bug. The reserved `min-width` on the <Num> wrapper means the dash
 *     occupies the same box the real value will.
 */

export const DASH = '—'; //  —

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** `1284 ms`. Always milliseconds, always integer. */
export function formatLatency(ms) {
  return isNum(ms) ? `${Math.round(ms)} ms` : DASH;
}

/** `$0.0143`. Fixed decimal places so the string width never changes. */
export function formatUsd(value, decimals = 4) {
  return isNum(value) ? `$${value.toFixed(decimals)}` : DASH;
}

/** Plain integer count. */
export function formatCount(value) {
  return isNum(value) ? String(Math.round(value)) : DASH;
}

/** Grouped integer, for token totals that get large. */
export function formatTokens(value) {
  return isNum(value) ? Math.round(value).toLocaleString('en-US') : DASH;
}

/**
 * `98.4%` from a 0..1 fraction.
 *
 * `hasSamples` guards the empty system: the API honestly reports
 * `success_rate: 0` when nothing has run, but rendering "0.0%" reads as a
 * catastrophe rather than as "nothing has happened yet".
 */
export function formatPercent(fraction, hasSamples = true) {
  if (!hasSamples || !isNum(fraction)) return DASH;
  return `${(fraction * 100).toFixed(1)}%`;
}

/** `0.82` -- model confidence, two decimals. */
export function formatConfidence(value) {
  return isNum(value) ? value.toFixed(2) : DASH;
}

/** `14:03:27` local wall clock; the stream is read left-to-right by time. */
export function formatClock(iso) {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

/** `$0.015 / 1k` -- an agent's price card, not a live figure. */
export function formatRate1k(value) {
  return isNum(value) ? `$${value.toFixed(3)} / 1k` : DASH;
}
