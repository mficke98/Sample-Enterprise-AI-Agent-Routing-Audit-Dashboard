import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { simulateExecution, estimateTokens, costMicrosFor, microsToUsd, OUTCOME } from '../src/domain/executor.js';
import { createRng } from '../src/lib/rng.js';
import { config } from '../src/config.js';
import { makeRegistry, withConfig, instantExecution, VALID_TASK } from './helpers.js';

const task = { ...VALID_TASK, id: 'task-0001' };

describe('cost arithmetic', () => {
  test('converts tokens to micro-dollars at the agent rate', () => {
    // 1000 tokens at $0.015/1k = $0.015 = 15000 micros
    assert.equal(costMicrosFor(1000, 0.015), 15000);
    assert.equal(costMicrosFor(500, 0.02), 10000);
    assert.equal(costMicrosFor(0, 0.02), 0);
  });

  test('micros round-trip to USD', () => {
    assert.equal(microsToUsd(15000), 0.015);
    assert.equal(microsToUsd(0), 0);
  });

  test('integer micros avoid the float drift that plain dollar addition produces', () => {
    // The classic failure: adding $0.008-scale floats 1000 times.
    let floatTotal = 0;
    let microTotal = 0;
    for (let i = 0; i < 1000; i += 1) {
      floatTotal += (250 / 1000) * 0.008; // $0.002 per iteration
      microTotal += costMicrosFor(250, 0.008);
    }
    assert.equal(microsToUsd(microTotal), 2, 'integer accumulation is exact');
    assert.notEqual(floatTotal, 2, 'float accumulation drifts (this is why we use micros)');
  });

  test('a zero-cost agent produces zero cost, not NaN', () => {
    assert.equal(costMicrosFor(5000, 0), 0);
  });
});

describe('estimateTokens', () => {
  test('scales with payload size', () => {
    const rng = createRng(1);
    const small = estimateTokens({ title: 'a', payload: 'x'.repeat(100) }, rng);
    const large = estimateTokens({ title: 'a', payload: 'x'.repeat(10000) }, rng);
    assert.ok(large > small * 5, `expected large payload to cost far more: ${small} vs ${large}`);
  });

  test('always returns at least 1 token, even for minimal input', () => {
    const rng = createRng(1);
    assert.ok(estimateTokens({ title: '', payload: '' }, rng) >= 1);
  });

  test('tolerates missing fields without producing NaN', () => {
    const rng = createRng(1);
    const tokens = estimateTokens({}, rng);
    assert.ok(Number.isFinite(tokens) && tokens > 0);
  });

  test('is deterministic under a fixed seed', () => {
    assert.equal(
      estimateTokens(task, createRng(99)),
      estimateTokens(task, createRng(99)),
    );
  });
});

describe('simulateExecution - success path', () => {
  let restore;
  afterEach(() => restore?.());

  test('returns structured output, confidence and latency (the three the spec names)', async () => {
    restore = instantExecution({ failureRate: 0 });
    const registry = makeRegistry();
    const result = await simulateExecution(registry.get('agent-tax-01'), task, { rng: createRng(1) });

    assert.equal(result.outcome, OUTCOME.SUCCESS);
    assert.ok(result.output.summary, 'structured output');
    assert.ok(Array.isArray(result.output.findings) && result.output.findings.length > 0);
    assert.ok(result.confidence > 0 && result.confidence <= 1, 'confidence score');
    assert.ok(Number.isFinite(result.latency_ms) && result.latency_ms >= 0, 'processing latency');
    assert.equal(result.error, null);
  });

  test('output content is specialised per agent type', async () => {
    restore = instantExecution({ failureRate: 0 });
    const registry = makeRegistry();
    const rng = createRng(5);

    const tax = await simulateExecution(registry.get('agent-tax-01'), task, { rng });
    const security = await simulateExecution(registry.get('agent-sec-03'), task, { rng });

    assert.equal(tax.output.classification, 'REVIEW_REQUIRED');
    assert.equal(security.output.classification, 'PII_DETECTED');
    assert.notEqual(tax.output.summary, security.output.summary);
  });

  test('the GENERAL agent reports lower confidence than a specialist', async () => {
    restore = instantExecution({ failureRate: 0 });
    const registry = makeRegistry();

    const specialistScores = [];
    const generalScores = [];
    for (let i = 0; i < 50; i += 1) {
      specialistScores.push((await simulateExecution(registry.get('agent-tax-01'), task, { rng: createRng(i) })).confidence);
      generalScores.push((await simulateExecution(registry.get('agent-gen-00'), task, { rng: createRng(i) })).confidence);
    }
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(avg(generalScores) < avg(specialistScores), 'falling back should visibly cost output quality');
    assert.ok(Math.max(...generalScores) <= 0.85);
    assert.ok(Math.min(...specialistScores) >= 0.82);
  });

  test('cost is derived from the executing agent\'s own rate', async () => {
    restore = instantExecution({ failureRate: 0 });
    const registry = makeRegistry();
    const rng = () => createRng(7);

    const tax = await simulateExecution(registry.get('agent-tax-01'), task, { rng: rng() });      // $0.015/1k
    const general = await simulateExecution(registry.get('agent-gen-00'), task, { rng: rng() });  // $0.005/1k

    assert.equal(tax.tokens_used, general.tokens_used, 'same seed, same token count');
    assert.ok(tax.cost_micros > general.cost_micros, 'the cheaper agent must cost less for identical work');
    assert.equal(tax.cost_micros, costMicrosFor(tax.tokens_used, 0.015));
  });
});

describe('simulateExecution - failure path', () => {
  let restore;
  afterEach(() => restore?.());

  test('failureRate=1 always fails', async () => {
    restore = instantExecution({ failureRate: 1 });
    const registry = makeRegistry();
    for (let i = 0; i < 25; i += 1) {
      const result = await simulateExecution(registry.get('agent-tax-01'), task, { rng: createRng(i) });
      assert.notEqual(result.outcome, OUTCOME.SUCCESS);
    }
  });

  test('failureRate=0 never fails', async () => {
    restore = instantExecution({ failureRate: 0 });
    const registry = makeRegistry();
    for (let i = 0; i < 25; i += 1) {
      const result = await simulateExecution(registry.get('agent-tax-01'), task, { rng: createRng(i) });
      assert.equal(result.outcome, OUTCOME.SUCCESS);
    }
  });

  test('timeoutShare selects between TIMEOUT and ERROR', async () => {
    const registry = makeRegistry();

    restore = instantExecution({ failureRate: 1, timeoutShare: 1 });
    const timeout = await simulateExecution(registry.get('agent-tax-01'), task, { rng: createRng(3) });
    assert.equal(timeout.outcome, OUTCOME.TIMEOUT);
    restore();

    restore = instantExecution({ failureRate: 1, timeoutShare: 0 });
    const error = await simulateExecution(registry.get('agent-tax-01'), task, { rng: createRng(3) });
    assert.equal(error.outcome, OUTCOME.ERROR);
  });

  test('a failure carries a human-readable error naming the agent, and no output', async () => {
    restore = instantExecution({ failureRate: 1, timeoutShare: 1 });
    const registry = makeRegistry();
    const result = await simulateExecution(registry.get('agent-audit-02'), task, { rng: createRng(3) });

    assert.match(result.error, /Audit Risk Scraper/);
    assert.equal(result.output, null);
    assert.equal(result.confidence, null);
  });

  test('a failed attempt still records tokens and cost (failures are not free)', async () => {
    restore = instantExecution({ failureRate: 1 });
    const registry = makeRegistry();
    const result = await simulateExecution(registry.get('agent-tax-01'), task, { rng: createRng(3) });

    assert.ok(result.tokens_used > 0, 'the model was still invoked');
    assert.ok(result.cost_micros > 0, 'billing must reflect the wasted spend');
  });

  test('the default ~10% failure rate lands in range over many runs', async () => {
    restore = instantExecution({ failureRate: 0.1 });
    const registry = makeRegistry();
    const rng = createRng(2024);
    let failures = 0;
    const runs = 2000;
    for (let i = 0; i < runs; i += 1) {
      const result = await simulateExecution(registry.get('agent-tax-01'), task, { rng });
      if (result.outcome !== OUTCOME.SUCCESS) failures += 1;
    }
    const rate = failures / runs;
    assert.ok(rate > 0.07 && rate < 0.13, `expected ~10% failures, got ${(rate * 100).toFixed(1)}%`);
  });
});

describe('simulateExecution - timing and contract', () => {
  let restore;
  afterEach(() => restore?.());

  test('honours the configured delay window', async () => {
    restore = withConfig({ minDelayMs: 40, maxDelayMs: 60, failureRate: 0 });
    const registry = makeRegistry();
    const started = Date.now();
    const result = await simulateExecution(registry.get('agent-tax-01'), task, { rng: createRng(1) });
    const elapsed = Date.now() - started;

    assert.ok(result.planned_delay_ms >= 40 && result.planned_delay_ms <= 60);
    assert.ok(elapsed >= 35, `should actually wait, took ${elapsed}ms`);
  });

  test('reports measured latency, not merely the planned delay', async () => {
    restore = instantExecution({ failureRate: 0 });
    const registry = makeRegistry();
    // With an injected instant sleep, planned delay is nonzero but real elapsed
    // time is ~0. Latency must reflect what actually happened.
    restore();
    restore = withConfig({ minDelayMs: 5000, maxDelayMs: 5000, failureRate: 0 });
    const result = await simulateExecution(registry.get('agent-tax-01'), task, {
      rng: createRng(1),
      sleep: async () => {},
    });
    assert.equal(result.planned_delay_ms, 5000);
    assert.ok(result.latency_ms < 100, `measured latency should be near zero, got ${result.latency_ms}`);
  });

  test('rejects missing dependencies loudly rather than producing garbage', async () => {
    const registry = makeRegistry();
    await assert.rejects(() => simulateExecution(null, task, { rng: createRng(1) }), /requires an agent/);
    await assert.rejects(() => simulateExecution(registry.get('agent-tax-01'), task, {}), /requires an rng/);
  });

  test('every attempt records which agent ran it (audit trail requirement)', async () => {
    restore = instantExecution({ failureRate: 0 });
    const registry = makeRegistry();
    const result = await simulateExecution(registry.get('agent-sec-03'), task, { rng: createRng(1) });
    assert.equal(result.agent_id, 'agent-sec-03');
    assert.equal(result.agent_name, 'Security & PII Scanner');
    assert.equal(result.agent_type, 'SECURITY');
    assert.ok(Date.parse(result.at) > 0, 'timestamped');
  });
});
