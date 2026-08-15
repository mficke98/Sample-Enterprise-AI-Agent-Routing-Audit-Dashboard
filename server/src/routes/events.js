import { Router } from 'express';

import { config } from '../config.js';
import { bus, EVENTS } from '../lib/bus.js';
import { computeMetrics } from '../domain/metrics.js';
import { toPublicTask } from '../domain/serializers.js';

const STREAMED_EVENTS = [
  EVENTS.TASK_CREATED,
  EVENTS.TASK_STARTED,
  EVENTS.TASK_COMPLETED,
  EVENTS.TASK_FAILED,
  EVENTS.TASK_FALLBACK,
  EVENTS.AGENT_STATUS,
  EVENTS.METRICS_UPDATED,
];

export function createEventRoutes({ registry, taskStore, dispatcher }) {
  const router = Router();

  /**
   * Every open stream, tracked so shutdown can end them.
   *
   * Without this, `server.close()` waits forever: an SSE response is an open
   * connection that never completes on its own, so a graceful shutdown hangs
   * until the process is killed. This bit us in the test suite first, but it is
   * a real SIGTERM defect, not a test artefact.
   */
  const clients = new Set();

  /**
   * GET /api/events - Server-Sent Events stream.
   *
   * Chosen over WebSockets because the traffic is strictly one-directional
   * (server -> dashboard); SSE gets automatic browser reconnection and needs no
   * extra dependency or second protocol to debug.
   */
  router.get('/', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Defeats proxy buffering, which otherwise holds events until the
      // response is large enough to flush -- the classic "SSE works locally
      // but not behind nginx" failure.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const send = (event, data) => {
      // If the client has gone away mid-write, stop rather than throwing.
      if (res.writableEnded) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Snapshot first, so a dashboard that connects late (or reconnects) is
    // fully hydrated without needing a separate round of REST calls.
    send('snapshot', {
      agents: registry.listPublic(),
      tasks: taskStore.list({ limit: 100 }).map(toPublicTask),
      metrics: computeMetrics({ registry, taskStore, dispatcher }),
      config: {
        failure_rate: config.failureRate,
        min_delay_ms: config.minDelayMs,
        max_delay_ms: config.maxDelayMs,
      },
    });

    const listeners = new Map();
    for (const eventName of STREAMED_EVENTS) {
      const listener = (envelope) => send(eventName, envelope.data);
      listeners.set(eventName, listener);
      bus.on(eventName, listener);
    }
    clients.add(res);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, config.heartbeatMs);
    heartbeat.unref?.();

    // Cleanup is not optional: without it every dashboard refresh leaks a set
    // of bus listeners and an interval, and the process slowly dies.
    const cleanup = () => {
      clearInterval(heartbeat);
      for (const [eventName, listener] of listeners) bus.off(eventName, listener);
      listeners.clear();
      clients.delete(res);
    };

    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });

  /** End every open stream so the HTTP server can actually close. */
  function closeAll() {
    for (const res of clients) {
      try {
        res.end();
      } catch {
        // Already torn down; nothing to do.
      }
    }
    clients.clear();
  }

  return { router, closeAll, clientCount: () => clients.size };
}
