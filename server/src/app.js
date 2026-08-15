import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { config } from './config.js';
import { AgentRegistry } from './domain/agentRegistry.js';
import { TaskStore } from './domain/taskStore.js';
import { Dispatcher } from './domain/dispatcher.js';
import { startMetricsBroadcaster } from './domain/metricsBroadcaster.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createAgentRoutes } from './routes/agents.js';
import { createMetricsRoutes } from './routes/metrics.js';
import { createEventRoutes } from './routes/events.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..');

export const defaultPaths = {
  agentsConfig: join(projectRoot, 'agents_config.json'),
  sampleTasks: join(projectRoot, 'sample_tasks.json'),
};

/**
 * App factory rather than a module-level singleton.
 *
 * Each call gets its own registry and task store, so the test suite can spin up
 * fully isolated instances in-process without cross-test state bleed -- which
 * matters a lot here, because agent concurrency counters are global mutable
 * state and a leaked slot in one test would silently break the next.
 */
export function createApp({ paths = defaultPaths, registry, taskStore, dispatcher, autoDispatch } = {}) {
  const agentRegistry = registry ?? new AgentRegistry();
  if (!registry) agentRegistry.load(paths.agentsConfig);

  const store = taskStore ?? new TaskStore();

  const shouldAutoDispatch = autoDispatch ?? config.autoDispatch;
  const taskDispatcher = dispatcher ?? new Dispatcher({ registry: agentRegistry, taskStore: store });
  if (shouldAutoDispatch) taskDispatcher.start();

  const stopBroadcaster = startMetricsBroadcaster({
    registry: agentRegistry,
    taskStore: store,
    dispatcher: taskDispatcher,
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, uptime_s: Math.round(process.uptime()), config: publicConfig() });
  });

  const wiring = { registry: agentRegistry, taskStore: store, dispatcher: taskDispatcher };

  const events = createEventRoutes(wiring);

  app.use('/api/tasks', createTaskRoutes({ ...wiring, paths }));
  app.use('/api/agents', createAgentRoutes(wiring));
  app.use('/api/metrics', createMetricsRoutes(wiring));
  app.use('/api/events', events.router);

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}.` } });
  });

  app.use(errorHandler);

  app.locals.registry = agentRegistry;
  app.locals.taskStore = store;
  app.locals.dispatcher = taskDispatcher;
  app.locals.paths = paths;
  /**
   * Release timers, bus listeners and open streams.
   *
   * Ending the SSE responses is what allows server.close() to complete -- an
   * open event stream is a connection that never finishes on its own, so
   * without this a graceful shutdown hangs indefinitely.
   */
  app.locals.shutdown = () => {
    taskDispatcher.stop();
    stopBroadcaster();
    events.closeAll();
  };
  app.locals.sseClientCount = events.clientCount;
  return app;
}

/** Surfaces the simulation knobs so the dashboard can show what mode it is in. */
function publicConfig() {
  return {
    failure_rate: config.failureRate,
    min_delay_ms: config.minDelayMs,
    max_delay_ms: config.maxDelayMs,
    seeded: config.seed !== null,
    auto_dispatch: config.autoDispatch,
  };
}

/**
 * Single error boundary. Domain errors carry `httpStatus` and `code`, so the
 * HTTP layer never string-matches on messages to decide a status.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
function errorHandler(err, req, res, next) {
  const status = err.httpStatus ?? 500;

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.path}`, err);
  }

  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
  }

  res.status(status).json({
    error: {
      code: err.code ?? 'INTERNAL_ERROR',
      message: status >= 500 ? 'Internal server error.' : err.message,
      ...(err.errors ? { details: err.errors } : {}),
    },
  });
}
