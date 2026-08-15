import { EventEmitter } from 'node:events';

/**
 * Single app-wide event bus. The domain layer emits; the SSE route and the
 * dispatcher subscribe. This keeps the domain free of any HTTP awareness --
 * executor.js has no idea a browser exists.
 */
export const bus = new EventEmitter();

// Every connected SSE client attaches listeners; the default cap of 10 would
// print spurious leak warnings with a handful of dashboard tabs open.
bus.setMaxListeners(0);

export const EVENTS = {
  TASK_CREATED: 'task.created',
  TASK_STARTED: 'task.started',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  TASK_FALLBACK: 'task.fallback',
  AGENT_STATUS: 'agent.status',
  METRICS_UPDATED: 'metrics.updated',
};

export function emit(event, payload) {
  bus.emit(event, { event, at: new Date().toISOString(), data: payload });
}
