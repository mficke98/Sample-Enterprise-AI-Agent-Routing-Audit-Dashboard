import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { AgentRegistry } from '../src/domain/agentRegistry.js';
import { AGENT_STATUS } from '../src/config.js';
import { AGENTS_FIXTURE, makeRegistry, withConfig, paths } from './helpers.js';

describe('AgentRegistry - loading and validation', () => {
  test('loads the real agents_config.json from disk', () => {
    const registry = new AgentRegistry();
    registry.load(paths.agentsConfig);
    assert.equal(registry.all().length, 4);
    assert.equal(registry.get('agent-tax-01').name, 'Tax Compliance Agent');
  });

  test('rejects a non-array config', () => {
    assert.throws(() => new AgentRegistry().load({ id: 'x' }), /must be a JSON array/);
  });

  test('rejects an empty config (nothing to route to)', () => {
    assert.throws(() => new AgentRegistry().load([]), /empty/);
  });

  test('rejects an agent missing required fields, naming every problem at once', () => {
    assert.throws(
      () => new AgentRegistry().load([{ id: 'a', name: 'A' }]),
      (err) => err.message.includes('type') && err.message.includes('max_concurrent') && err.message.includes('cost_per_1k_tokens'),
    );
  });

  test('rejects max_concurrent of 0 or negative (would deadlock the dispatcher)', () => {
    const bad = [{ ...AGENTS_FIXTURE[0], max_concurrent: 0 }];
    assert.throws(() => new AgentRegistry().load(bad), /max_concurrent must be an integer >= 1/);
  });

  test('rejects non-integer max_concurrent', () => {
    const bad = [{ ...AGENTS_FIXTURE[0], max_concurrent: 2.5 }];
    assert.throws(() => new AgentRegistry().load(bad), /max_concurrent/);
  });

  test('rejects negative cost', () => {
    const bad = [{ ...AGENTS_FIXTURE[0], cost_per_1k_tokens: -1 }];
    assert.throws(() => new AgentRegistry().load(bad), /cost_per_1k_tokens/);
  });

  test('rejects duplicate agent ids (silent overwrite would lose an agent)', () => {
    const dupes = [AGENTS_FIXTURE[0], { ...AGENTS_FIXTURE[1], id: 'agent-tax-01' }];
    assert.throws(() => new AgentRegistry().load(dupes), /Duplicate agent id/);
  });

  test('normalises type casing so routing is case-insensitive', () => {
    const registry = new AgentRegistry();
    registry.load([{ ...AGENTS_FIXTURE[0], type: 'tax' }]);
    assert.equal(registry.byType('TAX').length, 1);
    assert.equal(registry.byType('tax').length, 1);
  });

  test('warns but does not throw when no GENERAL agent exists', () => {
    const withoutGeneral = AGENTS_FIXTURE.filter((a) => a.type !== 'GENERAL');
    const registry = new AgentRegistry();
    const originalWarn = console.warn;
    let warned = '';
    console.warn = (msg) => { warned = String(msg); };
    try {
      assert.doesNotThrow(() => registry.load(withoutGeneral));
    } finally {
      console.warn = originalWarn;
    }
    assert.match(warned, /Fallback routing is disabled/);
    assert.equal(registry.fallbackAgent(), null);
  });

  test('reloading replaces prior agents rather than appending', () => {
    const registry = makeRegistry();
    registry.load([AGENTS_FIXTURE[0]]);
    assert.equal(registry.all().length, 1);
  });
});

describe('AgentRegistry - capacity accounting', () => {
  test('acquire succeeds up to max_concurrent then refuses', () => {
    const registry = makeRegistry();
    // Audit agent has max_concurrent: 2
    assert.equal(registry.acquire('agent-audit-02'), true);
    assert.equal(registry.acquire('agent-audit-02'), true);
    assert.equal(registry.acquire('agent-audit-02'), false, 'third acquire must be refused');
    assert.equal(registry.get('agent-audit-02').active, 2, 'refused acquire must not increment');
  });

  test('release frees a slot and never drops below zero', () => {
    const registry = makeRegistry();
    registry.acquire('agent-audit-02');
    registry.release('agent-audit-02');
    assert.equal(registry.get('agent-audit-02').active, 0);
    registry.release('agent-audit-02'); // extra release
    assert.equal(registry.get('agent-audit-02').active, 0, 'must not go negative');
  });

  test('acquire on an unknown agent id returns false rather than throwing', () => {
    assert.equal(makeRegistry().acquire('does-not-exist'), false);
  });

  test('release on an unknown agent id is a no-op', () => {
    assert.doesNotThrow(() => makeRegistry().release('does-not-exist'));
  });

  test('freeSlots and hasCapacity track acquisitions', () => {
    const registry = makeRegistry();
    assert.equal(registry.freeSlots('agent-tax-01'), 3);
    registry.acquire('agent-tax-01');
    assert.equal(registry.freeSlots('agent-tax-01'), 2);
    assert.equal(registry.hasCapacity('agent-tax-01'), true);
    registry.acquire('agent-tax-01');
    registry.acquire('agent-tax-01');
    assert.equal(registry.hasCapacity('agent-tax-01'), false);
    assert.equal(registry.freeSlots('agent-tax-01'), 0);
  });

  test('release records success and failure counters and cost separately', () => {
    const registry = makeRegistry();
    registry.acquire('agent-tax-01');
    registry.release('agent-tax-01', { failed: false, latencyMs: 100, tokens: 500, costMicros: 7500 });
    registry.acquire('agent-tax-01');
    registry.release('agent-tax-01', { failed: true, latencyMs: 50, tokens: 200, costMicros: 3000 });

    const agent = registry.get('agent-tax-01');
    assert.equal(agent.completed, 1);
    assert.equal(agent.failed, 1);
    assert.equal(agent.totalLatencyMs, 150);
    assert.equal(agent.totalTokens, 700);
    assert.equal(agent.costMicros, 10500);
  });
});

describe('AgentRegistry - derived status', () => {
  let restore;
  afterEach(() => restore?.());

  test('IDLE when nothing is active and nothing has failed', () => {
    const registry = makeRegistry();
    assert.equal(registry.statusOf(registry.get('agent-tax-01')), AGENT_STATUS.IDLE);
  });

  test('PROCESSING while a slot is held', () => {
    const registry = makeRegistry();
    registry.acquire('agent-tax-01');
    assert.equal(registry.statusOf(registry.get('agent-tax-01')), AGENT_STATUS.PROCESSING);
  });

  test('ERROR after a failure, for the sticky window only', () => {
    restore = withConfig({ errorStickyMs: 5000 });
    const registry = makeRegistry();
    registry.acquire('agent-tax-01');
    registry.release('agent-tax-01', { failed: true });

    const agent = registry.get('agent-tax-01');
    assert.equal(registry.statusOf(agent), AGENT_STATUS.ERROR);

    // Past the sticky window it reverts without any timer having to fire.
    const later = Date.now() + 6000;
    assert.equal(registry.statusOf(agent, later), AGENT_STATUS.IDLE);
  });

  test('PROCESSING outranks a recent ERROR', () => {
    restore = withConfig({ errorStickyMs: 5000 });
    const registry = makeRegistry();
    registry.acquire('agent-tax-01');
    registry.release('agent-tax-01', { failed: true });
    registry.acquire('agent-tax-01');
    assert.equal(registry.statusOf(registry.get('agent-tax-01')), AGENT_STATUS.PROCESSING);
  });

  test('status is derived, so a stale stored value can never desync', () => {
    const registry = makeRegistry();
    const agent = registry.get('agent-tax-01');
    agent.status = 'TOTALLY_WRONG'; // simulate a stale field
    assert.equal(registry.statusOf(agent), AGENT_STATUS.IDLE);
    assert.equal(registry.toPublic(agent).status, AGENT_STATUS.IDLE);
  });
});

describe('AgentRegistry - public shape', () => {
  test('exposes everything the status board needs', () => {
    const registry = makeRegistry();
    registry.acquire('agent-audit-02');
    const view = registry.toPublic(registry.get('agent-audit-02'));

    assert.equal(view.id, 'agent-audit-02');
    assert.equal(view.status, AGENT_STATUS.PROCESSING);
    assert.equal(view.active, 1);
    assert.equal(view.max_concurrent, 2);
    assert.equal(view.capacity_label, '1/2');
    assert.equal(view.utilization, 0.5);
    assert.equal(view.is_fallback_agent, false);
  });

  test('flags the GENERAL agent so the UI can mark it as the fallback target', () => {
    const registry = makeRegistry();
    assert.equal(registry.toPublic(registry.get('agent-gen-00')).is_fallback_agent, true);
  });

  test('resetState clears counters but keeps configuration', () => {
    const registry = makeRegistry();
    registry.acquire('agent-tax-01');
    registry.release('agent-tax-01', { failed: true, tokens: 10, costMicros: 5 });
    registry.resetState();

    const agent = registry.get('agent-tax-01');
    assert.equal(agent.active, 0);
    assert.equal(agent.failed, 0);
    assert.equal(agent.totalTokens, 0);
    assert.equal(agent.lastErrorAt, null);
    assert.equal(agent.max_concurrent, 3, 'config must survive');
  });
});
