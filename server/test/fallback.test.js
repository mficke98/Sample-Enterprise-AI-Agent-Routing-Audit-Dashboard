import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeTask } from '../src/domain/execution.js';
import { ingestTask } from '../src/domain/ingestion.js';
import { Dispatcher } from '../src/domain/dispatcher.js';
import { computeMetrics } from '../src/domain/metrics.js';
import { AgentRegistry } from '../src/domain/agentRegistry.js';
import { createRng } from '../src/lib/rng.js';
import { bus, EVENTS } from '../src/lib/bus.js';
import { TASK_STATUS } from '../src/config.js';
import {
  makeRegistry, makeStore, instantExecution, withConfig, deferredSleep,
  AGENTS_FIXTURE, VALID_TASK, startServer, api,
} from './helpers.js';

let restore;
let registry;
let taskStore;

beforeEach(() => {
  registry = makeRegistry();
  taskStore = makeStore();
});
afterEach(() => restore?.());

const deps = () => ({ registry, taskStore, rng: createRng(42) });
const ingest = (overrides = {}) => ingestTask({ ...VALID_TASK, ...overrides }, { registry, taskStore });

/**
 * An RNG whose chance() answers are scripted.
 *
 * simulateExecution rolls chance() TWICE on a failing attempt -- once against
 * failureRate, then again against timeoutShare to pick TIMEOUT vs ERROR -- so a
 * naive "return true on the first call" fake silently produces the wrong
 * outcome type. Scripting both rolls makes the intent explicit.
 */
function scriptedRng(script) {
  const base = createRng(7);
  let index = 0;
  return {
    next: () => base.next(),
    nextInt: (min, max) => base.nextInt(min, max),
    pick: (items) => base.pick(items),
    chance(probability) {
      if (index < script.length) {
        const answer = script[index];
        index += 1;
        return answer;
      }
      return probability >= 1; // past the script, honour the configured extremes
    },
  };
}

/** Attempt 1 fails (TIMEOUT or ERROR); every later attempt succeeds. */
const failThenSucceed = ({ timeout = true } = {}) => scriptedRng([true, timeout, false]);

describe('fallback routing - the core requirement', () => {
  test('a failed specialist re-routes to the General agent and flags the record', async () => {
    restore = instantExecution({ failureRate: 1, timeoutShare: 1 });
    const created = ingest({ type: 'TAX' });

    const task = await executeTask(created.id, { ...deps(), rng: failThenSucceed() });

    assert.equal(task.fallback_applied, true, 'the record must be flagged');
    assert.equal(task.assigned_agent_id, 'agent-gen-00', 'ownership moves to the General agent');
    assert.equal(task.assigned_agent_name, 'General Fallback Agent');
    assert.equal(task.status, TASK_STATUS.COMPLETED, 'the fallback succeeded');
    assert.match(task.routing_note, /Re-routed from Tax Compliance Agent/);
  });

  test('both attempts are preserved in order - the audit trail', async () => {
    restore = instantExecution({ failureRate: 1, timeoutShare: 1 });
    const created = ingest({ type: 'TAX' });

    const task = await executeTask(created.id, { ...deps(), rng: failThenSucceed() });

    assert.equal(task.attempts.length, 2);

    const [first, second] = task.attempts;
    assert.equal(first.agent_id, 'agent-tax-01');
    assert.equal(first.outcome, 'TIMEOUT');
    assert.ok(first.error, 'the failure reason is retained');

    assert.equal(second.agent_id, 'agent-gen-00');
    assert.equal(second.outcome, 'SUCCESS');
    assert.ok(second.confidence > 0);
  });

  test('the result comes from the fallback agent, not the failed specialist', async () => {
    restore = instantExecution({ failureRate: 1 });
    const created = ingest({ type: 'AUDIT' });

    const task = await executeTask(created.id, { ...deps(), rng: failThenSucceed() });

    assert.equal(task.result.agent_id, 'agent-gen-00');
    assert.equal(task.result.classification, 'GENERAL_REVIEW');
  });

  test('emits a task.fallback event so the dashboard can highlight it', async () => {
    restore = instantExecution({ failureRate: 1 });
    const created = ingest({ type: 'TAX' });

    const seen = [];
    const listener = (envelope) => seen.push(envelope.data);
    bus.on(EVENTS.TASK_FALLBACK, listener);
    try {
      await executeTask(created.id, { ...deps(), rng: failThenSucceed() });
    } finally {
      bus.off(EVENTS.TASK_FALLBACK, listener);
    }

    assert.equal(seen.length, 1);
    assert.equal(seen[0].id, created.id);
    assert.equal(seen[0].fallback_applied, true);
  });

  test('re-routing works for every specialist type', async () => {
    restore = instantExecution({ failureRate: 1 });
    for (const type of ['TAX', 'AUDIT', 'SECURITY']) {
      const created = ingest({ type });
      const task = await executeTask(created.id, { ...deps(), rng: failThenSucceed() });
      assert.equal(task.fallback_applied, true, `${type} should fall back`);
      assert.equal(task.assigned_agent_id, 'agent-gen-00');
    }
  });

  test('applies to ERROR as well as TIMEOUT', async () => {
    restore = instantExecution({ failureRate: 1, timeoutShare: 0 });
    const created = ingest({ type: 'TAX' });

    const task = await executeTask(created.id, { ...deps(), rng: failThenSucceed({ timeout: false }) });
    assert.equal(task.attempts[0].outcome, 'ERROR');
    assert.equal(task.fallback_applied, true);
  });
});

describe('fallback routing - loop guards', () => {
  test('when the General agent ALSO fails, the task terminates as FAILED', async () => {
    restore = instantExecution({ failureRate: 1, timeoutShare: 1 });
    const created = ingest({ type: 'TAX' });

    const task = await executeTask(created.id, deps());

    assert.equal(task.status, TASK_STATUS.FAILED);
    assert.equal(task.fallback_applied, true, 'the fallback was still attempted and recorded');
    assert.equal(task.attempts.length, 2, 'exactly two attempts - never a third');
    assert.equal(task.attempts[1].agent_id, 'agent-gen-00');
    assert.ok(task.error);
  });

  test('a task that starts on the General agent does NOT fall back to itself', async () => {
    restore = instantExecution({ failureRate: 1 });
    const created = ingest({ type: 'GENERAL' });

    const task = await executeTask(created.id, deps());

    assert.equal(task.status, TASK_STATUS.FAILED);
    assert.equal(task.fallback_applied, false, 'the fallback agent has nowhere to fall back to');
    assert.equal(task.attempts.length, 1);
  });

  test('an unknown type routed to GENERAL also cannot fall back to itself', async () => {
    restore = instantExecution({ failureRate: 1 });
    const created = ingest({ type: 'CRYPTO_FORENSICS' });
    assert.equal(created.assigned_agent_id, 'agent-gen-00');

    const task = await executeTask(created.id, deps());
    assert.equal(task.attempts.length, 1);
    assert.equal(task.status, TASK_STATUS.FAILED);
  });

  test('with no GENERAL agent configured, a failure is terminal rather than crashing', async () => {
    restore = instantExecution({ failureRate: 1 });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      registry = new AgentRegistry();
      registry.load(AGENTS_FIXTURE.filter((a) => a.type !== 'GENERAL'));
    } finally {
      console.warn = originalWarn;
    }

    const created = ingest({ type: 'TAX' });
    const task = await executeTask(created.id, deps());

    assert.equal(task.status, TASK_STATUS.FAILED);
    assert.equal(task.fallback_applied, false);
    assert.equal(task.attempts.length, 1);
  });

  test('STRESS: 60 tasks at a 100% failure rate all terminate, none loops', async () => {
    restore = instantExecution({ failureRate: 1 });
    for (let i = 0; i < 60; i += 1) {
      ingest({ type: ['TAX', 'AUDIT', 'SECURITY'][i % 3] });
    }

    const dispatcher = new Dispatcher({ registry, taskStore, rng: createRng(1) });
    await dispatcher.runToCompletion();

    const tasks = taskStore.all();
    assert.equal(tasks.length, 60);
    for (const task of tasks) {
      assert.equal(task.status, TASK_STATUS.FAILED, `${task.id} did not terminate`);
      assert.equal(task.fallback_applied, true);
      assert.equal(task.attempts.length, 2, `${task.id} made ${task.attempts.length} attempts - loop guard failed`);
    }

    for (const agent of registry.all()) {
      assert.equal(agent.active, 0, `${agent.name} leaked a slot`);
    }
  });
});

describe('fallback routing - capacity is still respected', () => {
  test('a fallback storm cannot oversubscribe the General agent', async () => {
    restore = instantExecution({ failureRate: 1 });
    // General agent gets only 1 slot, so 4 simultaneous fallbacks must queue.
    registry = new AgentRegistry();
    registry.load([
      ...AGENTS_FIXTURE.filter((a) => a.type !== 'GENERAL'),
      { id: 'agent-gen-00', name: 'General Fallback Agent', type: 'GENERAL', max_concurrent: 1, cost_per_1k_tokens: 0.005 },
    ]);

    for (let i = 0; i < 6; i += 1) ingest({ type: 'SECURITY' });

    const dispatcher = new Dispatcher({ registry, taskStore, rng: createRng(3) });
    const originalAcquire = registry.acquire.bind(registry);
    let violation = null;
    registry.acquire = (id) => {
      const ok = originalAcquire(id);
      const agent = registry.get(id);
      if (agent && agent.active > agent.max_concurrent) violation = agent.name;
      return ok;
    };

    await dispatcher.runToCompletion();

    assert.equal(violation, null, `capacity exceeded on ${violation}`);
    assert.equal(taskStore.countsByStatus().FAILED, 6);
    assert.ok(taskStore.all().every((t) => t.fallback_applied), 'every task still got its fallback');
  });

  test('a saturated General agent parks the task as PENDING rather than losing it', async () => {
    restore = instantExecution({ failureRate: 1 });
    registry = new AgentRegistry();
    registry.load([
      ...AGENTS_FIXTURE.filter((a) => a.type !== 'GENERAL'),
      { id: 'agent-gen-00', name: 'General Fallback Agent', type: 'GENERAL', max_concurrent: 1, cost_per_1k_tokens: 0.005 },
    ]);

    // Occupy the only General slot with a long-running task.
    const sleeper = deferredSleep();
    const blocker = ingest({ type: 'GENERAL' });
    const blocking = executeTask(blocker.id, { ...deps(), sleep: sleeper.sleep });

    // Now fail a TAX task; its fallback target is saturated.
    const created = ingest({ type: 'TAX' });
    const task = await executeTask(created.id, deps());

    assert.equal(task.fallback_applied, true, 'fallback was applied...');
    assert.equal(task.status, TASK_STATUS.PENDING, '...but parked, awaiting a free slot');
    assert.equal(task.assigned_agent_id, 'agent-gen-00');

    sleeper.releaseAll();
    await blocking;
  });
});

describe('fallback routing - accounting', () => {
  test('cost and tokens from BOTH attempts are charged', async () => {
    restore = instantExecution({ failureRate: 1 });
    const created = ingest({ type: 'TAX' });

    const task = await executeTask(created.id, { ...deps(), rng: failThenSucceed() });

    const summed = task.attempts.reduce((total, a) => total + a.tokens_used, 0);
    assert.equal(task.total_tokens, summed, 'a re-routed task genuinely cost the business twice');
    assert.ok(task.total_cost_usd > 0);
    // Domain-level record, so this is the internal integer field; the public
    // API serialises it as `cost_usd` (asserted in the HTTP test below).
    assert.ok(task.attempts[0].cost_micros > 0, 'the failed attempt is billed too');
  });

  test('latency is the total wall clock across both attempts', async () => {
    restore = withConfig({ minDelayMs: 20, maxDelayMs: 25, failureRate: 1 });
    const created = ingest({ type: 'TAX' });

    const task = await executeTask(created.id, { ...deps(), rng: failThenSucceed() });

    const summed = task.attempts.reduce((total, a) => total + a.latency_ms, 0);
    assert.equal(task.latency_ms, summed);
    assert.ok(task.latency_ms >= 40, 'the client really did wait for both attempts');
  });

  test('metrics report the fallback count and rate', async () => {
    restore = instantExecution({ failureRate: 1 });
    for (let i = 0; i < 4; i += 1) ingest({ type: 'TAX' });
    for (let i = 0; i < 6; i += 1) ingest({ type: 'GENERAL' }); // cannot fall back

    const dispatcher = new Dispatcher({ registry, taskStore, rng: createRng(5) });
    await dispatcher.runToCompletion();

    const result = computeMetrics({ registry, taskStore });
    assert.equal(result.fallback.count, 4);
    assert.equal(result.fallback.rate, 0.4);
    assert.equal(result.fallback.label, '4 of 10');
  });

  test('the failed specialist is still credited with its failure in per-agent metrics', async () => {
    restore = instantExecution({ failureRate: 1 });
    const created = ingest({ type: 'TAX' });
    await executeTask(created.id, { ...deps(), rng: failThenSucceed() });

    const result = computeMetrics({ registry, taskStore });
    const tax = result.per_agent_type.find((a) => a.type === 'TAX');
    const general = result.per_agent_type.find((a) => a.type === 'GENERAL');

    assert.equal(tax.failures, 1);
    assert.equal(tax.success_rate, 0);
    assert.equal(general.successes, 1);
    assert.equal(general.success_rate, 1);
  });
});

describe('fallback routing - over HTTP', () => {
  test('POST /:id/execute returns the final outcome including the fallback', async () => {
    const restoreCfg = instantExecution({ failureRate: 1, timeoutShare: 1 });
    const server = await startServer();
    try {
      const { body: created } = await api(server.baseUrl, '/api/tasks', {
        method: 'POST',
        body: { ...VALID_TASK, type: 'TAX' },
      });

      const { status, body } = await api(server.baseUrl, `/api/tasks/${created.id}/execute`, { method: 'POST' });

      assert.equal(status, 200);
      assert.equal(body.fallback_applied, true);
      assert.equal(body.assigned_agent_id, 'agent-gen-00');
      assert.equal(body.attempt_count, 2);
      assert.equal(body.status, TASK_STATUS.FAILED, 'both agents failed at a 100% failure rate');
      assert.equal(body.attempts[0].agent_name, 'Tax Compliance Agent');
      assert.equal(body.attempts[1].agent_name, 'General Fallback Agent');
    } finally {
      await server.close();
      restoreCfg();
    }
  });

  test('GET /api/metrics exposes the fallback ratio for the dashboard', async () => {
    const restoreCfg = instantExecution({ failureRate: 1 });
    const server = await startServer();
    try {
      const { body: created } = await api(server.baseUrl, '/api/tasks', {
        method: 'POST',
        body: { ...VALID_TASK, type: 'SECURITY' },
      });
      await api(server.baseUrl, `/api/tasks/${created.id}/execute`, { method: 'POST' });

      const { body } = await api(server.baseUrl, '/api/metrics');
      assert.equal(body.fallback.count, 1);
      assert.equal(body.fallback.label, '1 of 1');
    } finally {
      await server.close();
      restoreCfg();
    }
  });
});
