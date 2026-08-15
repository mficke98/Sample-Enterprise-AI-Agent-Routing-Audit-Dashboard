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

/**
 * Boot the real Express app on an ephemeral port.
 *
 * autoDispatch defaults to FALSE here: most tests assert on the state a task is
 * in immediately after ingestion, and a background dispatcher racing to execute
 * it would make those assertions flaky. Tests that want the dispatcher opt in.
 */
export async function startServer({ autoDispatch = false, ...options } = {}) {
  const app = createApp({ paths, autoDispatch, ...options });
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
    dispatcher: app.locals.dispatcher,
    async close() {
      app.locals.shutdown?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Poll until a condition holds. Used instead of fixed sleeps so teardown-timing
 * assertions are deterministic rather than "probably long enough".
 */
export async function waitUntil(predicate, { timeoutMs = 3000, intervalMs = 10, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Wait until the server has released every SSE connection. */
export function waitForSseDrain(server) {
  return waitUntil(() => server.app.locals.sseClientCount() === 0, { label: 'SSE clients to drain' });
}

/**
 * Open a live SSE connection and consume it in the background.
 *
 * Resolves only once the server's `snapshot` frame has arrived, which is the
 * signal that the request handler has run and attached its bus listeners.
 * Awaiting that -- rather than sleeping and hoping -- is what makes these tests
 * deterministic; a fixed sleep races the TCP connect and intermittently misses
 * the first pushed event.
 */
export async function openSse(baseUrl, { path = '/api/events', readyTimeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });

  const frames = [];
  const waiters = new Set();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let split;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (raw.startsWith(':')) continue; // heartbeat comment
          const event = /^event: (.+)$/m.exec(raw)?.[1];
          const data = /^data: (.+)$/m.exec(raw)?.[1];
          if (!event) continue;
          frames.push({ event, data: data ? JSON.parse(data) : null });
          for (const notify of [...waiters]) notify();
        }
      }
    } catch {
      // Aborted by close() -- expected.
    }
  })();

  const client = {
    response,
    frames,
    events: () => frames.map((f) => f.event),

    waitFor(eventName, { timeoutMs = 5000 } = {}) {
      const existing = frames.find((f) => f.event === eventName);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const check = () => {
          const found = frames.find((f) => f.event === eventName);
          if (!found) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(found);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`Timed out waiting for SSE "${eventName}". Saw: [${client.events().join(', ')}]`));
        }, timeoutMs);
        waiters.add(check);
      });
    },

    close() {
      controller.abort();
    },
  };

  await client.waitFor('snapshot', { timeoutMs: readyTimeoutMs });
  return client;
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
