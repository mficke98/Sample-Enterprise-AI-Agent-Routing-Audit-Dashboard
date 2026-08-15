import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer, api, openSse, waitUntil, waitForSseDrain, instantExecution, VALID_TASK } from './helpers.js';
import { bus } from '../src/lib/bus.js';

let server;
let restore;

before(async () => {
  restore = instantExecution({ failureRate: 0, heartbeatMs: 1000 });
  server = await startServer();
});

after(async () => {
  await server.close();
  restore?.();
});

beforeEach(() => {
  server.taskStore.reset();
  server.registry.resetState();
});

describe('GET /api/events - stream contract', () => {
  test('responds with SSE headers', async () => {
    const sse = await openSse(server.baseUrl);
    try {
      assert.equal(sse.response.status, 200);
      assert.match(sse.response.headers.get('content-type'), /text\/event-stream/);
      assert.match(sse.response.headers.get('cache-control'), /no-cache/);
      assert.equal(sse.response.headers.get('x-accel-buffering'), 'no', 'must defeat proxy buffering');
    } finally {
      sse.close();
    }
  });

  test('sends a hydrating snapshot immediately on connect', async () => {
    await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });

    const sse = await openSse(server.baseUrl);
    try {
      const snapshot = await sse.waitFor('snapshot');
      assert.equal(sse.events()[0], 'snapshot', 'snapshot must be the first frame');
      assert.equal(snapshot.data.agents.length, 4);
      assert.equal(snapshot.data.tasks.length, 1, 'a late-joining client hydrates without extra REST calls');
      assert.ok(snapshot.data.metrics.totals);
      assert.equal(snapshot.data.config.failure_rate, 0);
    } finally {
      sse.close();
    }
  });

  test('snapshot reflects live agent state, not just static config', async () => {
    server.registry.acquire('agent-tax-01');
    const sse = await openSse(server.baseUrl);
    try {
      const snapshot = await sse.waitFor('snapshot');
      const tax = snapshot.data.agents.find((a) => a.id === 'agent-tax-01');
      assert.equal(tax.status, 'PROCESSING');
      assert.equal(tax.capacity_label, '1/3');
    } finally {
      sse.close();
      server.registry.release('agent-tax-01');
    }
  });
});

describe('GET /api/events - live push', () => {
  test('pushes task.created when a task is ingested', async () => {
    const sse = await openSse(server.baseUrl);
    try {
      await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });

      const created = await sse.waitFor('task.created');
      assert.equal(created.data.title, VALID_TASK.title);
      assert.equal(created.data.status, 'PENDING');
      assert.equal(created.data.assigned_agent_id, 'agent-tax-01');
    } finally {
      sse.close();
    }
  });

  test('pushes the full lifecycle when a task is executed', async () => {
    const { body: created } = await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });

    const sse = await openSse(server.baseUrl);
    try {
      await api(server.baseUrl, `/api/tasks/${created.id}/execute`, { method: 'POST' });

      const started = await sse.waitFor('task.started');
      assert.equal(started.data.status, 'PROCESSING');

      const completed = await sse.waitFor('task.completed');
      assert.equal(completed.data.status, 'COMPLETED');
      assert.ok(completed.data.result.confidence > 0);

      await sse.waitFor('agent.status');
    } finally {
      sse.close();
    }
  });

  test('broadcasts coalesced metrics updates', async () => {
    const sse = await openSse(server.baseUrl);
    try {
      await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });

      const updated = await sse.waitFor('metrics.updated');
      assert.ok(Number.isFinite(updated.data.totals.tasks));
      assert.ok(updated.data.system_health.status);
    } finally {
      sse.close();
    }
  });

  test('a burst of ingests does not produce one metrics frame per task', async () => {
    const sse = await openSse(server.baseUrl);
    try {
      await api(server.baseUrl, '/api/tasks/seed/sample', { method: 'POST' });
      await sse.waitFor('metrics.updated');
      // Let the coalescing window pass entirely.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const metricsFrames = sse.frames.filter((f) => f.event === 'metrics.updated').length;
      const createdFrames = sse.frames.filter((f) => f.event === 'task.created').length;
      assert.equal(createdFrames, 3, 'all three sample tasks announced');
      assert.ok(metricsFrames < createdFrames, `metrics recomputes should coalesce, got ${metricsFrames}`);
    } finally {
      sse.close();
    }
  });
});

describe('GET /api/events - resource cleanup', () => {
  test('removes every bus listener when a client disconnects', async () => {
    // Measure only once prior tests' streams have actually been released,
    // otherwise the baseline is taken mid-teardown and the delta is wrong.
    await waitForSseDrain(server);
    const baseline = bus.listenerCount('task.created');

    const sse = await openSse(server.baseUrl);
    assert.ok(
      bus.listenerCount('task.created') > baseline,
      `listener should be attached while connected (baseline ${baseline})`,
    );
    assert.equal(server.app.locals.sseClientCount(), 1);

    sse.close();
    await waitForSseDrain(server);

    assert.equal(
      bus.listenerCount('task.created'),
      baseline,
      'listeners must be released on disconnect or every dashboard refresh leaks',
    );
  });

  test('repeated connect/disconnect cycles do not accumulate listeners', async () => {
    await waitForSseDrain(server);
    const baseline = bus.listenerCount('task.completed');

    for (let i = 0; i < 5; i += 1) {
      const sse = await openSse(server.baseUrl);
      sse.close();
      await waitForSseDrain(server);
    }

    assert.equal(bus.listenerCount('task.completed'), baseline, 'listener count must return to baseline');
    assert.equal(server.app.locals.sseClientCount(), 0);
  });

  test('multiple concurrent clients each receive the same event', async () => {
    await waitForSseDrain(server);
    const clientA = await openSse(server.baseUrl);
    const clientB = await openSse(server.baseUrl);
    try {
      await waitUntil(() => server.app.locals.sseClientCount() === 2, { label: 'two connected clients' });
      await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });

      const [a, b] = await Promise.all([clientA.waitFor('task.created'), clientB.waitFor('task.created')]);
      assert.equal(a.data.id, b.data.id, 'both clients see the same task');
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  test('an open stream does not prevent the server from shutting down', async () => {
    // Regression guard: an SSE response is a connection that never ends on its
    // own, so without explicit teardown server.close() hangs forever.
    const isolated = await startServer();
    await openSse(isolated.baseUrl);

    const closed = await Promise.race([
      isolated.close().then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 3000)),
    ]);

    assert.equal(closed, 'closed', 'shutdown must not hang on an open event stream');
  });
});

describe('GET /api/metrics', () => {
  test('returns the full aggregate shape the dashboard cards need', async () => {
    const { status, body } = await api(server.baseUrl, '/api/metrics');

    assert.equal(status, 200);
    assert.ok(body.totals, 'Total Tasks card');
    assert.ok(body.latency, 'Average Latency card');
    assert.ok(body.system_health.status, 'System Health card');
    assert.ok(body.cost, 'Total Cost card');
    assert.ok(Array.isArray(body.per_agent_type));
    assert.ok(body.fallback);
  });

  test('reflects executed work', async () => {
    const { body: created } = await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });
    await api(server.baseUrl, `/api/tasks/${created.id}/execute`, { method: 'POST' });

    const { body } = await api(server.baseUrl, '/api/metrics');
    assert.equal(body.totals.completed, 1);
    assert.equal(body.success_rate, 1);
    assert.ok(body.cost.total_usd > 0);
    assert.equal(body.system_health.status, 'HEALTHY');
  });
});
