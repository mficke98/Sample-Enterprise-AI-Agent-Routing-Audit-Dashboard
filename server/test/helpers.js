import { config } from '../src/config.js';
import { AgentRegistry } from '../src/domain/agentRegistry.js';
import { TaskStore } from '../src/domain/taskStore.js';
import { createApp } from '../src/app.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(here, '..', '..');
export const paths = {
  agentsConfig: join(projectRoot, 'agents_config.json'),
  sampleTasks: join(projectRoot, 'sample_tasks.json'),
};

/**
 * Temporarily override simulation config.
 *
 * `config` is a plain mutable object precisely so tests can do this without
 * re-importing modules or spawning subprocesses per env permutation. Always
 * call the returned restore() in a finally/after hook.
 */
export function withConfig(overrides) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = config[key];
    config[key] = value;
  }
  return function restore() {
    Object.assign(config, previous);
  };
}

/** Zero-latency execution so tests run in milliseconds, not minutes. */
export function instantExecution(extra = {}) {
  return withConfig({ minDelayMs: 0, maxDelayMs: 0, ...extra });
}

export const AGENTS_FIXTURE = [
  { id: 'agent-tax-01', name: 'Tax Compliance Agent', type: 'TAX', max_concurrent: 3, cost_per_1k_tokens: 0.015, status: 'IDLE' },
  { id: 'agent-audit-02', name: 'Audit Risk Scraper', type: 'AUDIT', max_concurrent: 2, cost_per_1k_tokens: 0.02, status: 'IDLE' },
  { id: 'agent-sec-03', name: 'Security & PII Scanner', type: 'SECURITY', max_concurrent: 5, cost_per_1k_tokens: 0.008, status: 'IDLE' },
  { id: 'agent-gen-00', name: 'General Fallback Agent', type: 'GENERAL', max_concurrent: 10, cost_per_1k_tokens: 0.005, status: 'IDLE' },
];

export function makeRegistry(agents = AGENTS_FIXTURE) {
  const registry = new AgentRegistry();
  registry.load(structuredClone(agents));
  return registry;
}

export function makeStore() {
  return new TaskStore();
}

/** A sleep that the test controls: call release() to let execution proceed. */
export function deferredSleep() {
  const waiters = [];
  return {
    sleep: () => new Promise((resolve) => waiters.push(resolve)),
    releaseAll() {
      const pending = waiters.splice(0);
      pending.forEach((resolve) => resolve());
      return pending.length;
    },
    get pending() {
      return waiters.length;
    },
  };
}

/** Boot the real Express app on an ephemeral port. */
export async function startServer(options = {}) {
  const app = createApp({ paths, ...options });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return {
    app,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    registry: app.locals.registry,
    taskStore: app.locals.taskStore,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export async function api(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

export const VALID_TASK = {
  title: 'Q3 Corporate Tax Exemption Verification',
  type: 'TAX',
  payload: 'Review Schedule C filings for high-volume transactions.',
  priority: 'HIGH',
};
