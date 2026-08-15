/**
 * Runtime configuration.
 *
 * Everything that drives the simulation is env-tunable on purpose: the test
 * suite needs to force deterministic outcomes (FAILURE_RATE=1 to prove the
 * fallback path, FAILURE_RATE=0 to prove the happy path) and the live demo
 * needs to reproduce a fallback on command rather than waiting for a 10% dice
 * roll to land in front of a reviewer.
 */

/**
 * Parse a numeric env var without the `Number(x) || fallback` bug, which
 * silently rejects a legitimate 0 (e.g. MIN_DELAY_MS=0 or FAILURE_RATE=0).
 */
function num(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const minDelayMs = Math.max(0, num(process.env.MIN_DELAY_MS, 1000));
const maxDelayMs = Math.max(minDelayMs, num(process.env.MAX_DELAY_MS, 3000));

export const config = {
  port: num(process.env.PORT, 4000),

  /** Probability [0,1] that a single execution attempt fails. Spec asks for ~10%. */
  failureRate: clamp(num(process.env.FAILURE_RATE, 0.1), 0, 1),

  /** Of the failures, what share are TIMEOUT rather than ERROR. */
  timeoutShare: clamp(num(process.env.TIMEOUT_SHARE, 0.5), 0, 1),

  /** Artificial execution delay window. Spec asks for 1-3 seconds. */
  minDelayMs,
  maxDelayMs,

  /** Fixed seed makes the RNG reproducible; null means use Math.random(). */
  seed: process.env.SEED === undefined || process.env.SEED === '' ? null : Number(process.env.SEED),

  /** How long an agent visibly stays in ERROR after a failed attempt. */
  errorStickyMs: Math.max(0, num(process.env.ERROR_STICKY_MS, 5000)),

  /** Reject oversized payloads rather than letting them balloon token math. */
  maxPayloadChars: Math.max(1, num(process.env.MAX_PAYLOAD_CHARS, 10000)),
  maxTitleChars: Math.max(1, num(process.env.MAX_TITLE_CHARS, 200)),

  /** SSE keepalive so intermediaries don't reap an idle stream. */
  heartbeatMs: Math.max(1000, num(process.env.HEARTBEAT_MS, 15000)),

  /** Set to '0'/'false' to disable the background dispatcher (tests drive it manually). */
  autoDispatch: !['0', 'false', 'no'].includes(String(process.env.AUTO_DISPATCH ?? '1').toLowerCase()),
};

export const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
export const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
export const TASK_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};
export const AGENT_STATUS = {
  IDLE: 'IDLE',
  PROCESSING: 'PROCESSING',
  ERROR: 'ERROR',
};
export const FALLBACK_TYPE = 'GENERAL';
