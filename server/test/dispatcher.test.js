import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Dispatcher } from '../src/domain/dispatcher.js';
import { ingestTask } from '../src/domain/ingestion.js';
import { createRng } from '../src/lib/rng.js';
import { TASK_STATUS } from '../src/config.js';
import { makeRegistry, makeStore, instantExecution, deferredSleep, VALID_TASK } from './helpers.js';

let restore;
let registry;
let taskStore;

beforeEach(() => {
  registry = makeRegistry();
  taskStore = makeStore();
});
afterEach(() => restore?.());

function ingest(overrides = {}) {
  return ingestTask({ ...VALID_TASK, ...overrides }, { registry, taskStore });
}

function makeDispatcher(extra = {}) {
  return new Dispatcher({ registry, taskStore, rng: createRng(42), ...extra });
}

describe('Dispatcher - priority ordering', () => {
  test('dispatches HIGH before an earlier-submitted MEDIUM', async () => {
    restore = instantExecution({ failureRate: 0 });
    const sleeper = deferredSleep();

    // Saturate nothing; use AUDIT (max_concurrent 2) with 3 tasks so only the
    // first two can start, making dispatch order observable.
    const medium1 = ingest({ type: 'AUDIT', priority: 'MEDIUM', title: 'medium-1' });
    const medium2 = ingest({ type: 'AUDIT', priority: 'MEDIUM', title: 'medium-2' });
    const high = ingest({ type: 'AUDIT', priority: 'HIGH', title: 'high-late' });

    const dispatcher = makeDispatcher({ sleep: sleeper.sleep });
    dispatcher.drain();

    assert.equal(taskStore.get(high.id).status, TASK_STATUS.PROCESSING, 'HIGH must jump the queue');
    assert.equal(taskStore.get(medium1.id).status, TASK_STATUS.PROCESSING, 'oldest MEDIUM takes the second slot');
    assert.equal(taskStore.get(medium2.id).status, TASK_STATUS.PENDING, 'newest MEDIUM waits');

    sleeper.releaseAll();
    await dispatcher.idle();
  });

  test('FIFO within a priority tier - no starvation of an older task', async () => {
    restore = instantExecution({ failureRate: 0 });
    const sleeper = deferredSleep();

    const first = ingest({ type: 'AUDIT', priority: 'HIGH' });
    const second = ingest({ type: 'AUDIT', priority: 'HIGH' });
    const third = ingest({ type: 'AUDIT', priority: 'HIGH' });

    const dispatcher = makeDispatcher({ sleep: sleeper.sleep });
    dispatcher.drain();

    assert.equal(taskStore.get(first.id).status, TASK_STATUS.PROCESSING);
    assert.equal(taskStore.get(second.id).status, TASK_STATUS.PROCESSING);
    assert.equal(taskStore.get(third.id).status, TASK_STATUS.PENDING);

    sleeper.releaseAll();
    await dispatcher.idle();
  });

  test('full ordering: HIGH, then MEDIUM, then LOW', async () => {
    restore = instantExecution({ failureRate: 0 });
    const low = ingest({ type: 'AUDIT', priority: 'LOW' });
    const medium = ingest({ type: 'AUDIT', priority: 'MEDIUM' });
    const high = ingest({ type: 'AUDIT', priority: 'HIGH' });

    const order = taskStore.pendingByPriority().map((t) => t.id);
    assert.deepEqual(order, [high.id, medium.id, low.id]);
  });
});

describe('Dispatcher - capacity and head-of-line blocking', () => {
  test('never exceeds max_concurrent', async () => {
    restore = instantExecution({ failureRate: 0 });
    const sleeper = deferredSleep();
    for (let i = 0; i < 10; i += 1) ingest({ type: 'AUDIT' });

    const dispatcher = makeDispatcher({ sleep: sleeper.sleep });
    dispatcher.drain();

    assert.equal(registry.get('agent-audit-02').active, 2);

    sleeper.releaseAll();
    await dispatcher.idle();
  });

  test('a saturated agent does NOT block tasks bound for an idle agent', async () => {
    restore = instantExecution({ failureRate: 0 });
    const sleeper = deferredSleep();

    // Two HIGH audit tasks saturate the audit agent (max 2), a third HIGH audit
    // task must wait -- but the MEDIUM security task behind it must still run.
    ingest({ type: 'AUDIT', priority: 'HIGH' });
    ingest({ type: 'AUDIT', priority: 'HIGH' });
    const blockedAudit = ingest({ type: 'AUDIT', priority: 'HIGH' });
    const security = ingest({ type: 'SECURITY', priority: 'MEDIUM' });

    const dispatcher = makeDispatcher({ sleep: sleeper.sleep });
    dispatcher.drain();

    assert.equal(taskStore.get(blockedAudit.id).status, TASK_STATUS.PENDING, 'audit agent is full');
    assert.equal(
      taskStore.get(security.id).status,
      TASK_STATUS.PROCESSING,
      'lower-priority task on an idle agent must not be head-of-line blocked',
    );

    sleeper.releaseAll();
    await dispatcher.idle();
  });

  test('a skipped task is picked up on the next drain once a slot frees', async () => {
    restore = instantExecution({ failureRate: 0 });
    const sleeper = deferredSleep();
    ingest({ type: 'AUDIT' });
    ingest({ type: 'AUDIT' });
    const waiting = ingest({ type: 'AUDIT' });

    const dispatcher = makeDispatcher({ sleep: sleeper.sleep });
    dispatcher.drain();
    assert.equal(taskStore.get(waiting.id).status, TASK_STATUS.PENDING);

    sleeper.releaseAll();
    await dispatcher.idle();

    dispatcher.drain();
    assert.notEqual(taskStore.get(waiting.id).status, TASK_STATUS.PENDING, 'must not be stranded');

    sleeper.releaseAll();
    await dispatcher.idle();
  });

  test('records how often it skipped a saturated agent', async () => {
    restore = instantExecution({ failureRate: 0 });
    const sleeper = deferredSleep();
    for (let i = 0; i < 5; i += 1) ingest({ type: 'AUDIT' });

    const dispatcher = makeDispatcher({ sleep: sleeper.sleep });
    dispatcher.drain();
    assert.equal(dispatcher.stats.skippedAtCapacity, 3, '5 tasks, 2 slots -> 3 skipped');

    sleeper.releaseAll();
    await dispatcher.idle();
  });
});

describe('Dispatcher - draining to completion', () => {
  test('processes an entire mixed backlog', async () => {
    restore = instantExecution({ failureRate: 0 });
    for (let i = 0; i < 12; i += 1) {
      ingest({ type: ['TAX', 'AUDIT', 'SECURITY'][i % 3], priority: ['HIGH', 'MEDIUM', 'LOW'][i % 3] });
    }

    const dispatcher = makeDispatcher();
    await dispatcher.runToCompletion();

    const counts = taskStore.countsByStatus();
    assert.equal(counts.COMPLETED, 12);
    assert.equal(counts.PENDING, 0);
    assert.equal(counts.PROCESSING, 0);
  });

  test('leaves no agent slots held after a full drain', async () => {
    restore = instantExecution({ failureRate: 0 });
    for (let i = 0; i < 25; i += 1) ingest({ type: 'SECURITY' });

    const dispatcher = makeDispatcher();
    await dispatcher.runToCompletion();

    for (const agent of registry.all()) {
      assert.equal(agent.active, 0, `${agent.name} leaked a slot`);
    }
  });

  test('terminates rather than looping when tasks have no eligible agent', async () => {
    restore = instantExecution({ failureRate: 0 });
    const orphan = ingest();
    taskStore.update(orphan.id, { assigned_agent_id: 'agent-does-not-exist' });

    const dispatcher = makeDispatcher();
    await dispatcher.runToCompletion(); // must not hang or throw

    assert.equal(taskStore.get(orphan.id).status, TASK_STATUS.PENDING);
  });

  test('handles a 100-task burst without exceeding any capacity limit', async () => {
    restore = instantExecution({ failureRate: 0 });
    for (let i = 0; i < 100; i += 1) {
      ingest({ type: ['TAX', 'AUDIT', 'SECURITY', 'GENERAL'][i % 4] });
    }

    const dispatcher = makeDispatcher();
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
    assert.equal(taskStore.countsByStatus().COMPLETED, 100);
  });
});

describe('Dispatcher - lifecycle', () => {
  test('stop() halts dispatch', async () => {
    restore = instantExecution({ failureRate: 0 });
    const dispatcher = makeDispatcher();
    dispatcher.stop();
    ingest();
    assert.equal(dispatcher.drain(), 0, 'a stopped dispatcher must not launch work');
    assert.equal(taskStore.all()[0].status, TASK_STATUS.PENDING);
  });

  test('kick() on a stopped dispatcher is a no-op', () => {
    const dispatcher = makeDispatcher();
    dispatcher.stop();
    assert.doesNotThrow(() => dispatcher.kick());
  });

  test('REGRESSION: kick() does nothing on a constructed-but-never-started dispatcher', async () => {
    // `stopped` defaults to false, so gating kick() on it alone let a dispatcher
    // that was never start()ed still auto-execute tasks the caller expected to
    // remain PENDING -- which silently broke `autoDispatch: false`.
    restore = instantExecution({ failureRate: 0 });
    const dispatcher = makeDispatcher();
    const created = ingest();

    dispatcher.kick();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(taskStore.get(created.id).status, TASK_STATUS.PENDING, 'must not dispatch without start()');
    assert.equal(dispatcher.stats.launched, 0);
  });

  test('start() enables kick(), and the task actually runs', async () => {
    restore = instantExecution({ failureRate: 0 });
    const dispatcher = makeDispatcher();
    const created = ingest();

    dispatcher.start();
    await dispatcher.idle();

    assert.equal(taskStore.get(created.id).status, TASK_STATUS.COMPLETED);
    dispatcher.stop();
  });

  test('explicit drain() still works without start() (a direct command, not background activity)', async () => {
    restore = instantExecution({ failureRate: 0 });
    const dispatcher = makeDispatcher();
    ingest();

    assert.equal(dispatcher.drain(), 1);
    await dispatcher.idle();
  });

  test('drain is re-entrancy safe', async () => {
    restore = instantExecution({ failureRate: 0 });
    ingest();
    const dispatcher = makeDispatcher();
    dispatcher.draining = true; // simulate being mid-drain
    assert.equal(dispatcher.drain(), 0);
    dispatcher.draining = false;
    await dispatcher.runToCompletion();
  });

  test('queueDepth reflects pending work', async () => {
    restore = instantExecution({ failureRate: 0 });
    const dispatcher = makeDispatcher();
    assert.equal(dispatcher.queueDepth(), 0);
    ingest();
    ingest();
    assert.equal(dispatcher.queueDepth(), 2);
  });
});
