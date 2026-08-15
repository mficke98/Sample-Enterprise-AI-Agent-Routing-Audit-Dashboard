import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { selectAgent, selectFallbackAgent } from '../src/domain/router.js';
import { AgentRegistry } from '../src/domain/agentRegistry.js';
import { AGENTS_FIXTURE, makeRegistry } from './helpers.js';

describe('selectAgent - type matching', () => {
  const registry = makeRegistry();

  for (const [type, expectedId] of [
    ['TAX', 'agent-tax-01'],
    ['AUDIT', 'agent-audit-02'],
    ['SECURITY', 'agent-sec-03'],
    ['GENERAL', 'agent-gen-00'],
  ]) {
    test(`${type} routes to ${expectedId}`, () => {
      const { agent, note, reason } = selectAgent(type, { registry });
      assert.equal(agent.id, expectedId);
      assert.equal(note, null, 'a clean type match needs no routing note');
      assert.equal(reason, 'TYPE_MATCH');
    });
  }

  test('routing is case- and whitespace-insensitive', () => {
    assert.equal(selectAgent('  tax  ', { registry }).agent.id, 'agent-tax-01');
    assert.equal(selectAgent('Tax', { registry }).agent.id, 'agent-tax-01');
  });
});

describe('selectAgent - unknown and missing types fall back to GENERAL', () => {
  const registry = makeRegistry();

  test('an unknown type routes to GENERAL with an explanatory note', () => {
    const { agent, note, reason } = selectAgent('CRYPTO_FORENSICS', { registry });
    assert.equal(agent.id, 'agent-gen-00');
    assert.equal(reason, 'FALLBACK_UNKNOWN_TYPE');
    assert.match(note, /Unknown task type "CRYPTO_FORENSICS"/);
  });

  for (const missing of [undefined, null, '', '   ']) {
    test(`missing type (${JSON.stringify(missing)}) routes to GENERAL rather than throwing`, () => {
      const { agent } = selectAgent(missing, { registry });
      assert.equal(agent.id, 'agent-gen-00');
    });
  }
});

describe('selectAgent - exclusion', () => {
  test('excluding the specialist diverts to GENERAL', () => {
    const registry = makeRegistry();
    const { agent, reason, note } = selectAgent('TAX', { registry, exclude: ['agent-tax-01'] });
    assert.equal(agent.id, 'agent-gen-00');
    assert.equal(reason, 'FALLBACK_NO_SPECIALIST');
    assert.match(note, /No eligible TAX agent/);
  });

  test('excluding both the specialist and GENERAL yields no agent (never loops)', () => {
    const registry = makeRegistry();
    const { agent, reason } = selectAgent('TAX', { registry, exclude: ['agent-tax-01', 'agent-gen-00'] });
    assert.equal(agent, null);
    assert.equal(reason, 'NO_AGENT');
  });

  test('with no GENERAL configured, an unknown type yields no agent instead of crashing', () => {
    const registry = new AgentRegistry();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      registry.load(AGENTS_FIXTURE.filter((a) => a.type !== 'GENERAL'));
    } finally {
      console.warn = originalWarn;
    }
    const { agent, reason } = selectAgent('UNKNOWN', { registry });
    assert.equal(agent, null);
    assert.equal(reason, 'NO_AGENT');
  });
});

describe('selectAgent - load balancing between same-type agents', () => {
  test('prefers the agent with the most free capacity', () => {
    const registry = new AgentRegistry();
    registry.load([
      { id: 'tax-a', name: 'Tax A', type: 'TAX', max_concurrent: 2, cost_per_1k_tokens: 0.01 },
      { id: 'tax-b', name: 'Tax B', type: 'TAX', max_concurrent: 2, cost_per_1k_tokens: 0.01 },
      { id: 'gen', name: 'Gen', type: 'GENERAL', max_concurrent: 5, cost_per_1k_tokens: 0.005 },
    ]);

    registry.acquire('tax-a'); // tax-a now has 1 free, tax-b has 2
    assert.equal(selectAgent('TAX', { registry }).agent.id, 'tax-b');
  });

  test('ties break deterministically by id, not by object order', () => {
    const registry = new AgentRegistry();
    registry.load([
      { id: 'tax-z', name: 'Z', type: 'TAX', max_concurrent: 2, cost_per_1k_tokens: 0.01 },
      { id: 'tax-a', name: 'A', type: 'TAX', max_concurrent: 2, cost_per_1k_tokens: 0.01 },
      { id: 'gen', name: 'Gen', type: 'GENERAL', max_concurrent: 5, cost_per_1k_tokens: 0.005 },
    ]);
    assert.equal(selectAgent('TAX', { registry }).agent.id, 'tax-a');
  });

  test('selection does NOT consider capacity as a hard gate (that is the dispatcher\'s job)', () => {
    const registry = makeRegistry();
    // Saturate the tax agent entirely.
    registry.acquire('agent-tax-01');
    registry.acquire('agent-tax-01');
    registry.acquire('agent-tax-01');
    // A saturated specialist is still the correct OWNER of the work; the task
    // simply waits. Diverting to GENERAL on mere busyness would waste the
    // specialist and quietly degrade output quality.
    assert.equal(selectAgent('TAX', { registry }).agent.id, 'agent-tax-01');
  });
});

describe('selectFallbackAgent', () => {
  test('a failed specialist falls back to the GENERAL agent', () => {
    const registry = makeRegistry();
    const { agent, reason, note } = selectFallbackAgent('TAX', { registry, failedAgentId: 'agent-tax-01' });
    assert.equal(agent.id, 'agent-gen-00');
    assert.equal(reason, 'FALLBACK_APPLIED');
    assert.match(note, /Re-routed from Tax Compliance Agent/);
  });

  test('a failed GENERAL agent does NOT fall back to itself (loop guard)', () => {
    const registry = makeRegistry();
    const { agent, reason } = selectFallbackAgent('GENERAL', { registry, failedAgentId: 'agent-gen-00' });
    assert.equal(agent, null);
    assert.equal(reason, 'FALLBACK_EXHAUSTED');
  });

  test('reports clearly when no GENERAL agent is configured', () => {
    const registry = new AgentRegistry();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      registry.load(AGENTS_FIXTURE.filter((a) => a.type !== 'GENERAL'));
    } finally {
      console.warn = originalWarn;
    }
    const { agent, reason } = selectFallbackAgent('TAX', { registry, failedAgentId: 'agent-tax-01' });
    assert.equal(agent, null);
    assert.equal(reason, 'NO_FALLBACK_CONFIGURED');
  });

  test('an unknown failedAgentId still returns the GENERAL agent', () => {
    const registry = makeRegistry();
    const { agent } = selectFallbackAgent('TAX', { registry, failedAgentId: 'ghost' });
    assert.equal(agent.id, 'agent-gen-00');
  });
});
