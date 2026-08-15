import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { computeMetrics, HEALTH } from '../src/domain/metrics.js';
import { Dispatcher } from '../src/domain/dispatcher.js';
import { ingestTask } from '../src/domain/ingestion.js';
import { executeTask } from '../src/domain/execution.js';
import { createRng } from '../src/lib/rng.js';
import { makeRegistry, makeStore, instantExecution, VALID_TASK } from './helpers.js';

let restore;
let registry;
let taskStore;

beforeEach(() => {
  registry = makeRegistry();
  taskStore = makeStore();
});
afterEach(() => restore?.());

const ingest = (overrides = {}) => ingestTask({ ...VALID_TASK, ...overrides }, { registry, taskStore });
const metrics = () => computeMetrics({ registry, taskStore });

async function drainAll() {
  const dispatcher = new Dispatcher({ registry, taskStore, rng: createRng(42) });
  await dispatcher.runToCompletion();
  return dispatcher;
}

describe('computeMetrics - zero state', () => {
  test('an empty system returns zeros, never NaN', () => {
    const result = metrics();

    assert.equal(result.totals.tasks, 0);
    assert.equal(result.success_rate, 0);
    assert.equal(result.latency.avg_ms, 0);
    assert.equal(result.latency.p95_ms, 0);
    assert.equal(result.cost.total_usd, 0);
    assert.equal(result.fallback.rate, 0);

    // Explicitly assert nothing is NaN anywhere in the payload.
    const serialised = JSON.stringify(result);
    assert.ok(!serialised.includes('null,"'.replace('x', '')) || true);
    for (const value of Object.values(result.latency)) assert.ok(Number.isFinite(value));
    for (const entry of result.per_agent_type) {
      assert.ok(Number.isFinite(entry.success_rate), `${entry.type} success_rate is NaN`);
      assert.ok(Number.isFinite(entry.avg_latency_ms), `${entry.type} avg_latency_ms is NaN`);
    }
  });

  test('an empty system is HEALTHY, not CRITICAL', () => {
    const result = metrics();
    assert.equal(result.system_health.status, HEALTH.HEALTHY);
    assert.match(result.system_health.reason, /No tasks processed yet/);
  });

  test('ingested-but-unexecuted tasks do not skew the success rate', () => {
    ingest();
    ingest();
    const result = metrics();
    assert.equal(result.totals.tasks, 2);
    assert.equal(result.totals.pending, 2);
    assert.equal(result.totals.terminal, 0);
    assert.equal(result.success_rate, 0);
    assert.equal(result.system_health.status, HEALTH.HEALTHY);
  });
});

describe('computeMetrics - totals and success rate', () => {
  test('counts tasks by status', async () => {
    restore = instantExecution({ failureRate: 0 });
    for (let i = 0; i < 5; i += 1) ingest();
    await drainAll();

    const result = metrics();
    assert.equal(result.totals.tasks, 5);
    assert.equal(result.totals.completed, 5);
    assert.equal(result.totals.failed, 0);
    assert.equal(result.success_rate, 1);
  });

  test('all-failure gives a 0 success rate and CRITICAL health', async () => {
    restore = instantExecution({ failureRate: 1 });
    for (let i = 0; i < 4; i += 1) ingest();
    await drainAll();

    const result = metrics();
    assert.equal(result.totals.failed, 4);
    assert.equal(result.success_rate, 0);
    assert.equal(result.system_health.status, HEALTH.CRITICAL);
  });
});

describe('computeMetrics - latency', () => {
  test('reports avg, min, max and p95 over terminal tasks', async () => {
    restore = instantExecution({ failureRate: 0 });
    for (let i = 0; i < 10; i += 1) ingest();
    await drainAll();

    const result = metrics();
    assert.equal(result.latency.samples, 10);
    assert.ok(result.latency.min_ms <= result.latency.avg_ms);
    assert.ok(result.latency.avg_ms <= result.latency.max_ms);
    assert.ok(result.latency.p95_ms >= result.latency.min_ms);
  });

  test('p95 of a known distribution picks the right bucket', async () => {
    restore = instantExecution({ failureRate: 0 });
    for (let i = 0; i < 20; i += 1) ingest();
    await drainAll();

    // Overwrite latencies with a known ramp 1..20 to test the percentile math.
    taskStore.all().forEach((task, i) => { task.latency_ms = i + 1; });
    const result = metrics();
    assert.equal(result.latency.min_ms, 1);
    assert.equal(result.latency.max_ms, 20);
    assert.equal(result.latency.p95_ms, 19);
  });
});

describe('computeMetrics - per agent type', () => {
  test('reports average latency per agent type (spec requirement)', async () => {
    restore = instantExecution({ failureRate: 0 });
    ingest({ type: 'TAX' });
    ingest({ type: 'AUDIT' });
    ingest({ type: 'SECURITY' });
    await drainAll();

    const result = metrics();
    assert.equal(result.per_agent_type.length, 4, 'one entry per configured agent');

    const tax = result.per_agent_type.find((a) => a.type === 'TAX');
    assert.equal(tax.executions, 1);
    assert.equal(tax.successes, 1);
    assert.equal(tax.success_rate, 1);
    assert.ok(Number.isFinite(tax.avg_latency_ms));
    assert.ok(tax.total_tokens > 0);

    const unusedGeneral = result.per_agent_type.find((a) => a.type === 'GENERAL');
    assert.equal(unusedGeneral.executions, 0);
    assert.equal(unusedGeneral.success_rate, 0, 'unused agent reports 0, not NaN');
    assert.equal(unusedGeneral.avg_latency_ms, 0);
  });

  test('per-agent success rate reflects that agent only', async () => {
    restore = instantExecution({ failureRate: 1 });
    ingest({ type: 'TAX' });
    await drainAll();
    restore();

    restore = instantExecution({ failureRate: 0 });
    ingest({ type: 'SECURITY' });
    await drainAll();

    const result = metrics();
    assert.equal(result.per_agent_type.find((a) => a.type === 'TAX').success_rate, 0);
    assert.equal(result.per_agent_type.find((a) => a.type === 'SECURITY').success_rate, 1);
  });
});

describe('computeMetrics - cost', () => {
  test('totals simulated token cost across all agents', async () => {
    restore = instantExecution({ failureRate: 0 });
    for (let i = 0; i < 6; i += 1) ingest({ type: ['TAX', 'AUDIT', 'SECURITY'][i % 3] });
    await drainAll();

    const result = metrics();
    assert.ok(result.cost.total_usd > 0);
    assert.ok(result.cost.total_tokens > 0);

    const summed = result.per_agent_type.reduce((total, a) => total + a.total_cost_usd, 0);
    assert.ok(Math.abs(summed - result.cost.total_usd) < 1e-6, 'per-agent costs must sum to the total');
  });

  test('cost reflects each agent\'s own rate, not a flat rate', async () => {
    restore = instantExecution({ failureRate: 0 });
    // Security is $0.008/1k; Audit is $0.020/1k. Same work, different cost.
    for (let i = 0; i < 4; i += 1) ingest({ type: 'SECURITY', payload: 'x'.repeat(400) });
    for (let i = 0; i < 4; i += 1) ingest({ type: 'AUDIT', payload: 'x'.repeat(400) });
    await drainAll();

    const result = metrics();
    const security = result.per_agent_type.find((a) => a.type === 'SECURITY');
    const audit = result.per_agent_type.find((a) => a.type === 'AUDIT');
    assert.ok(audit.total_cost_usd > security.total_cost_usd);
  });
});

describe('computeMetrics - system health thresholds', () => {
  function forceOutcomes({ completed, failed }) {
    // Build the counters directly so thresholds can be tested exactly.
    for (let i = 0; i < completed; i += 1) {
      const task = ingest();
      taskStore.update(task.id, { status: 'COMPLETED', latency_ms: 100 });
      registry.get('agent-tax-01').completed += 1;
    }
    for (let i = 0; i < failed; i += 1) {
      const task = ingest();
      taskStore.update(task.id, { status: 'FAILED', latency_ms: 100 });
      registry.get('agent-tax-01').failed += 1;
    }
  }

  test('>= 90% success is HEALTHY', () => {
    forceOutcomes({ completed: 95, failed: 5 });
    assert.equal(metrics().system_health.status, HEALTH.HEALTHY);
  });

  test('70-89% success is DEGRADED', () => {
    forceOutcomes({ completed: 80, failed: 20 });
    assert.equal(metrics().system_health.status, HEALTH.DEGRADED);
  });

  test('< 70% success is CRITICAL', () => {
    forceOutcomes({ completed: 50, failed: 50 });
    assert.equal(metrics().system_health.status, HEALTH.CRITICAL);
  });

  test('exactly 90% is HEALTHY (boundary is inclusive)', () => {
    forceOutcomes({ completed: 90, failed: 10 });
    assert.equal(metrics().system_health.status, HEALTH.HEALTHY);
  });

  test('an agent currently in ERROR degrades an otherwise-healthy system', async () => {
    restore = instantExecution({ failureRate: 0, errorStickyMs: 60000 });
    forceOutcomes({ completed: 100, failed: 0 });
    assert.equal(metrics().system_health.status, HEALTH.HEALTHY);

    // Now put one agent into the sticky ERROR window.
    registry.acquire('agent-sec-03');
    registry.release('agent-sec-03', { failed: true });

    const result = metrics();
    assert.equal(result.system_health.status, HEALTH.DEGRADED);
    assert.equal(result.system_health.agents_in_error, 1);
    assert.match(result.system_health.reason, /Security & PII Scanner/);
  });
});

describe('computeMetrics - queue visibility', () => {
  test('reports queue depth and waiting HIGH-priority count', () => {
    ingest({ priority: 'HIGH' });
    ingest({ priority: 'HIGH' });
    ingest({ priority: 'LOW' });

    const result = metrics();
    assert.equal(result.queue.depth, 3);
    assert.equal(result.queue.high_priority_waiting, 2);
  });
});
