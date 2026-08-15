import { bus, emit, EVENTS } from '../lib/bus.js';
import { computeMetrics } from './metrics.js';

const TRIGGERS = [
  EVENTS.TASK_CREATED,
  EVENTS.TASK_STARTED,
  EVENTS.TASK_COMPLETED,
  EVENTS.TASK_FAILED,
  EVENTS.TASK_FALLBACK,
];

/**
 * Recomputes metrics once per burst and emits METRICS_UPDATED.
 *
 * Coalesced on a trailing timer: a seed of 20 tasks fires 20 creation events in
 * one tick, and recomputing (and broadcasting) the full aggregate 20 times is
 * pure waste. One recompute per window, computed centrally rather than once per
 * connected SSE client.
 */
export function startMetricsBroadcaster({ registry, taskStore, dispatcher, windowMs = 120 }) {
  let timer = null;

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      emit(EVENTS.METRICS_UPDATED, computeMetrics({ registry, taskStore, dispatcher }));
    }, windowMs);
    timer.unref?.();
  };

  for (const eventName of TRIGGERS) bus.on(eventName, schedule);

  return function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    for (const eventName of TRIGGERS) bus.off(eventName, schedule);
  };
}
