import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeTask, ExecutionError } from '../src/domain/execution.js';
import { ingestTask } from '../src/domain/ingestion.js';
import { createRng } from '../src/lib/rng.js';
import { TASK_STATUS, AGENT_STATUS } from '../src/config.js';
import { makeRegistry, makeStore, instantExecution, deferredSleep, VALID_TASK } from './helpers.js';

let restore;
let registry;
let taskStore;

beforeEach(() => {
  registry = makeRegistry();
  taskStore = makeStore();
});
afterEach(() => restore?.());

const deps = () => ({ registry, taskStore, rng: createRng(42) });

function ingest(overrides = {}) {
  return ingestTask({ ...VALID_TASK, ...overrides }, { registry, taskStore });
}

describe('executeTask - success path', () => {
  test('moves PENDING -> COMPLETED and records a full result', async () => {
    restore = instantExecution({ failureRate: 0 });
    const created = ingest();
    assert.equal(created.status, TASK_STATUS.PENDING, 'ingestion must set PENDING per spec');

    const task = await executeTask(created.id, deps());

    assert.equal(task.status, TASK_STATUS.COMPLETED);
    assert.ok(task.result.summary);
    assert.ok(task.result.confidence > 0);
    assert.ok(Number.isFinite(task.latency_ms));
    assert.ok(task.total_cost_usd > 0);
    assert.equal(task.attempts.length, 1);
    assert.equal(task.fallback_applied, false);
    assert.ok(task.started_at && task.completed_at);
  });

  test('releases the agent slot afterwards, returning it to IDLE', async () => {
    restore = instantExecution({ failureRate: 0 });
    const created = ingest();
    await executeTask(created.id, deps());

    const agent = registry.get('agent-tax-01');
    assert.equal(agent.active, 0, 'slot must not leak');
    assert.equal(agent.completed, 1);
    assert.equal(registry.statusOf(agent), AGENT_STATUS.IDLE);
  });

  test('accumulates the agent\'s cost and token counters', async () => {
    restore = instantExecution({ failureRate: 0 });
    await executeTask(ingest().id, deps());

    const agent = registry.get('agent-tax-01');
    assert.ok(agent.totalTokens > 0);
    assert.ok(agent.costMicros > 0);
  });
});

describe('executeTask - failure path', () => {
  test('marks the task FAILED and records the error once fallback is exhausted', async () => {
    restore = instantExecution({ failureRate: 1, timeoutShare: 1 });
    // Since the fallback-routing requirement landed, a failing specialist is
    // re-routed to the General agent first; only when that also fails does the
    // task terminate. See fallback.test.js for the routing itself.
    const task = await executeTask(ingest().id, deps());

    assert.equal(task.status, TASK_STATUS.FAILED);
    assert.match(task.error, /deadline/);
    assert.equal(task.attempts.length, 2, 'specialist attempt + fallback attempt');
    assert.equal(task.attempts[0].outcome, 'TIMEOUT');
    assert.equal(task.attempts[0].agent_id, 'agent-tax-01');
    assert.equal(task.attempts[1].agent_id, 'agent-gen-00');
    assert.equal(task.result, null);
  });

  test('a GENERAL task has no fallback target, so one failure is terminal', async () => {
    restore = instantExecution({ failureRate: 1, timeoutShare: 1 });
    const task = await executeTask(ingest({ type: 'GENERAL' }).id, deps());

    assert.equal(task.status, TASK_STATUS.FAILED);
    assert.equal(task.attempts.length, 1);
    assert.equal(task.fallback_applied, false);
  });

  test('still releases the slot and marks the agent ERROR', async () => {
    restore = instantExecution({ failureRate: 1, errorStickyMs: 5000 });
    await executeTask(ingest().id, deps());

    const agent = registry.get('agent-tax-01');
    assert.equal(agent.active, 0, 'a failed attempt must not leak its slot');
    assert.equal(agent.failed, 1);
    assert.equal(registry.statusOf(agent), AGENT_STATUS.ERROR);
  });

  test('a failed task still carries its cost (wasted spend is auditable)', async () => {
    restore = instantExecution({ failureRate: 1 });
    const task = await executeTask(ingest().id, deps());
    assert.ok(task.total_cost_usd > 0);
    assert.ok(task.total_tokens > 0);
  });

  test('an executor crash does not leak the concurrency slot', async () => {
    restore = instantExecution({ failureRate: 0 });
    const created = ingest();

    await assert.rejects(
      () => executeTask(created.id, {
        registry,
        taskStore,
        rng: createRng(1),
        sleep: () => { throw new Error('boom'); },
      }),
      (err) => err instanceof ExecutionError && err.code === 'EXECUTOR_CRASHED',
    );

    assert.equal(registry.get('agent-tax-01').active, 0, 'slot released despite the crash');
    assert.equal(taskStore.get(created.id).status, TASK_STATUS.FAILED);
  });
});

describe('executeTask - state guards', () => {
  test('unknown task id -> 404-mapped error', async () => {
    restore = instantExecution();
    await assert.rejects(
      () => executeTask('task-9999', deps()),
      (err) => err.code === 'TASK_NOT_FOUND' && err.httpStatus === 404,
    );
  });

  test('re-executing a COMPLETED task is refused (no double billing)', async () => {
    restore = instantExecution({ failureRate: 0 });
    const created = ingest();
    await executeTask(created.id, deps());

    await assert.rejects(
      () => executeTask(created.id, deps()),
      (err) => err.code === 'TASK_NOT_PENDING' && err.httpStatus === 409,
    );
    assert.equal(taskStore.get(created.id).attempts.length, 1, 'must not add a second attempt');
  });

  test('re-executing a FAILED task is refused', async () => {
    restore = instantExecution({ failureRate: 1 });
    const created = ingest();
    await executeTask(created.id, deps());
    await assert.rejects(() => executeTask(created.id, deps()), (err) => err.code === 'TASK_NOT_PENDING');
  });

  test('executing a task whose agent no longer exists fails terminally', async () => {
    restore = instantExecution();
    const created = ingest();
    taskStore.update(created.id, { assigned_agent_id: 'agent-deleted' });

    await assert.rejects(
      () => executeTask(created.id, deps()),
      (err) => err.code === 'NO_AGENT_ASSIGNED',
    );
    assert.equal(taskStore.get(created.id).status, TASK_STATUS.FAILED, 'must not sit PENDING forever');
  });
});

describe('executeTask - concurrency and capacity', () => {
  test('never exceeds max_concurrent, and refuses the overflow task', async () => {
    restore = instantExecution({ failureRate: 0 });
    const sleeper = deferredSleep();
    // Audit agent has max_concurrent: 2
    const a = ingest({ type: 'AUDIT' });
    const b = ingest({ type: 'AUDIT' });
    const c = ingest({ type: 'AUDIT' });

    const runA = executeTask(a.id, { ...deps(), sleep: sleeper.sleep });
    const runB = executeTask(b.id, { ...deps(), sleep: sleeper.sleep });
    const runC = executeTask(c.id, { ...deps(), sleep: sleeper.sleep }).catch((err) => err);

    const agent = registry.get('agent-audit-02');
    assert.equal(agent.active, 2, 'exactly max_concurrent slots in use');

    const overflow = await runC;
    assert.ok(overflow instanceof ExecutionError);
    assert.equal(overflow.code, 'AGENT_AT_CAPACITY');
    assert.equal(overflow.httpStatus, 409);
    assert.equal(taskStore.get(c.id).status, TASK_STATUS.PENDING, 'refused task stays PENDING, not FAILED');

    sleeper.releaseAll();
    await Promise.all([runA, runB]);

    assert.equal(agent.active, 0, 'all slots returned');
    assert.equal(taskStore.get(a.id).status, TASK_STATUS.COMPLETED);
    assert.equal(taskStore.get(b.id).status, TASK_STATUS.COMPLETED);
  });

  test('a refused overflow task can be executed later once a slot frees', async () => {
    restore = instantExecution({ failureRate: 0 });
    const sleeper = deferredSleep();
    const a = ingest({ type: 'AUDIT' });
    const b = ingest({ type: 'AUDIT' });
    const c = ingest({ type: 'AUDIT' });

    const runA = executeTask(a.id, { ...deps(), sleep: sleeper.sleep });
    const runB = executeTask(b.id, { ...deps(), sleep: sleeper.sleep });
    await executeTask(c.id, deps()).catch(() => {});

    sleeper.releaseAll();
    await Promise.all([runA, runB]);

    const retried = await executeTask(c.id, deps());
    assert.equal(retried.status, TASK_STATUS.COMPLETED);
  });

  test('different agent types do not contend for each other\'s slots', async () => {
    restore = instantExecution({ failureRate: 0 });
    const sleeper = deferredSleep();
    const audit1 = ingest({ type: 'AUDIT' });
    const audit2 = ingest({ type: 'AUDIT' });
    const tax = ingest({ type: 'TAX' });

    const runs = [
      executeTask(audit1.id, { ...deps(), sleep: sleeper.sleep }),
      executeTask(audit2.id, { ...deps(), sleep: sleeper.sleep }),
      executeTask(tax.id, { ...deps(), sleep: sleeper.sleep }),
    ];

    assert.equal(registry.get('agent-audit-02').active, 2, 'audit saturated');
    assert.equal(registry.get('agent-tax-01').active, 1, 'tax unaffected by audit saturation');

    sleeper.releaseAll();
    await Promise.all(runs);
  });

  test('a burst of 20 tasks never exceeds the security agent\'s 5 slots', async () => {
    restore = instantExecution({ failureRate: 0 });
    const sleeper = deferredSleep();
    const created = Array.from({ length: 20 }, () => ingest({ type: 'SECURITY' }));

    const runs = created.map((task) =>
      executeTask(task.id, { ...deps(), sleep: sleeper.sleep }).catch((err) => err),
    );

    const agent = registry.get('agent-sec-03');
    assert.equal(agent.active, 5, `expected 5 active, got ${agent.active}`);
    assert.ok(agent.active <= agent.max_concurrent);

    sleeper.releaseAll();
    const results = await Promise.all(runs);
    const refused = results.filter((r) => r instanceof ExecutionError);
    assert.equal(refused.length, 15, 'the other 15 were refused, not silently dropped');
    assert.equal(agent.active, 0, 'no slot leaked across 20 concurrent attempts');
  });
});
