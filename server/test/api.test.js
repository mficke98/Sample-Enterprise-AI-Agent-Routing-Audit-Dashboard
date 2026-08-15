import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer, api, instantExecution, VALID_TASK } from './helpers.js';
import { TASK_STATUS } from '../src/config.js';

let server;
let restore;

before(async () => {
  restore = instantExecution({ failureRate: 0 });
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

describe('GET /api/health', () => {
  test('reports ok and echoes the active simulation mode', async () => {
    const { status, body } = await api(server.baseUrl, '/api/health');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.config.failure_rate, 0);
  });
});

describe('POST /api/tasks - ingestion', () => {
  test('creates a task as PENDING assigned to the type-matched agent', async () => {
    const { status, body } = await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });

    assert.equal(status, 201);
    assert.equal(body.status, TASK_STATUS.PENDING);
    assert.equal(body.assigned_agent_id, 'agent-tax-01');
    assert.equal(body.assigned_agent_name, 'Tax Compliance Agent');
    assert.equal(body.fallback_applied, false);
    assert.equal(body.priority, 'HIGH');
    assert.ok(body.id.startsWith('task-'));
    assert.equal(body.attempts.length, 0);
  });

  test('routes each provided sample task to its correct specialist', async () => {
    const cases = [
      ['TAX', 'agent-tax-01'],
      ['SECURITY', 'agent-sec-03'],
      ['AUDIT', 'agent-audit-02'],
    ];
    for (const [type, expected] of cases) {
      const { body } = await api(server.baseUrl, '/api/tasks', {
        method: 'POST',
        body: { ...VALID_TASK, type },
      });
      assert.equal(body.assigned_agent_id, expected, `${type} should route to ${expected}`);
    }
  });

  test('an unknown type is accepted and routed to GENERAL with a note', async () => {
    const { status, body } = await api(server.baseUrl, '/api/tasks', {
      method: 'POST',
      body: { ...VALID_TASK, type: 'CRYPTO_FORENSICS' },
    });
    assert.equal(status, 201);
    assert.equal(body.assigned_agent_id, 'agent-gen-00');
    assert.match(body.routing_note, /Unknown task type/);
  });

  test('defaults priority to MEDIUM', async () => {
    const { title, type, payload } = VALID_TASK;
    const { body } = await api(server.baseUrl, '/api/tasks', { method: 'POST', body: { title, type, payload } });
    assert.equal(body.priority, 'MEDIUM');
  });

  test('rejects an invalid body with 400 and per-field details', async () => {
    const { status, body } = await api(server.baseUrl, '/api/tasks', {
      method: 'POST',
      body: { priority: 'URGENT' },
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_FAILED');
    const fields = body.error.details.map((d) => d.field);
    assert.deepEqual(fields.sort(), ['payload', 'priority', 'title']);
  });

  test('rejects malformed JSON with 400 rather than a 500 stack trace', async () => {
    const response = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json',
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'INVALID_JSON');
  });

  test('ignores unexpected extra fields', async () => {
    const { status, body } = await api(server.baseUrl, '/api/tasks', {
      method: 'POST',
      body: { ...VALID_TASK, injected: 'value' },
    });
    assert.equal(status, 201);
    assert.equal(body.injected, undefined);
  });
});

describe('POST /api/tasks/:id/execute', () => {
  test('returns structured output, confidence and latency', async () => {
    const { body: created } = await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });
    const { status, body } = await api(server.baseUrl, `/api/tasks/${created.id}/execute`, { method: 'POST' });

    assert.equal(status, 200);
    assert.equal(body.status, TASK_STATUS.COMPLETED);
    assert.ok(body.result.summary, 'structured output');
    assert.ok(Array.isArray(body.result.findings));
    assert.ok(body.result.confidence > 0 && body.result.confidence <= 1, 'confidence score');
    assert.ok(Number.isFinite(body.latency_ms), 'processing latency');
    assert.ok(body.total_cost_usd > 0);
  });

  test('404 for an unknown task id', async () => {
    const { status, body } = await api(server.baseUrl, '/api/tasks/task-9999/execute', { method: 'POST' });
    assert.equal(status, 404);
    assert.equal(body.error.code, 'TASK_NOT_FOUND');
  });

  test('409 when executing an already-completed task', async () => {
    const { body: created } = await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });
    await api(server.baseUrl, `/api/tasks/${created.id}/execute`, { method: 'POST' });
    const { status, body } = await api(server.baseUrl, `/api/tasks/${created.id}/execute`, { method: 'POST' });

    assert.equal(status, 409);
    assert.equal(body.error.code, 'TASK_NOT_PENDING');
  });
});

describe('GET /api/tasks', () => {
  test('lists tasks with a count', async () => {
    await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });
    await api(server.baseUrl, '/api/tasks', { method: 'POST', body: { ...VALID_TASK, type: 'AUDIT' } });

    const { status, body } = await api(server.baseUrl, '/api/tasks');
    assert.equal(status, 200);
    assert.equal(body.count, 2);
    assert.equal(body.tasks.length, 2);
  });

  test('filters by type and by status', async () => {
    await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });
    await api(server.baseUrl, '/api/tasks', { method: 'POST', body: { ...VALID_TASK, type: 'AUDIT' } });

    const byType = await api(server.baseUrl, '/api/tasks?type=AUDIT');
    assert.equal(byType.body.count, 1);
    assert.equal(byType.body.tasks[0].type, 'AUDIT');

    const byStatus = await api(server.baseUrl, '/api/tasks?status=PENDING');
    assert.equal(byStatus.body.count, 2);

    const none = await api(server.baseUrl, '/api/tasks?status=COMPLETED');
    assert.equal(none.body.count, 0);
  });

  test('honours a limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });
    }
    const { body } = await api(server.baseUrl, '/api/tasks?limit=2');
    assert.equal(body.count, 2);
  });

  test('ignores a nonsense limit rather than returning nothing', async () => {
    await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });
    const { body } = await api(server.baseUrl, '/api/tasks?limit=abc');
    assert.equal(body.count, 1);
  });

  test('GET /api/tasks/:id returns one task, 404 when absent', async () => {
    const { body: created } = await api(server.baseUrl, '/api/tasks', { method: 'POST', body: VALID_TASK });

    const found = await api(server.baseUrl, `/api/tasks/${created.id}`);
    assert.equal(found.status, 200);
    assert.equal(found.body.id, created.id);

    const missing = await api(server.baseUrl, '/api/tasks/task-9999');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'TASK_NOT_FOUND');
  });
});

describe('POST /api/tasks/seed/sample', () => {
  test('bulk-ingests the provided sample_tasks.json (which is not valid JSON as delivered)', async () => {
    const { status, body } = await api(server.baseUrl, '/api/tasks/seed/sample', { method: 'POST' });

    assert.equal(status, 201);
    assert.equal(body.count, 3);
    assert.deepEqual(body.tasks.map((t) => t.type), ['TAX', 'SECURITY', 'AUDIT']);
    assert.deepEqual(body.tasks.map((t) => t.assigned_agent_id), ['agent-tax-01', 'agent-sec-03', 'agent-audit-02']);
    assert.ok(body.tasks.every((t) => t.status === TASK_STATUS.PENDING));
  });
});

describe('GET /api/agents', () => {
  test('returns all four agents with live status board fields', async () => {
    const { status, body } = await api(server.baseUrl, '/api/agents');

    assert.equal(status, 200);
    assert.equal(body.count, 4);
    for (const agent of body.agents) {
      assert.ok(['IDLE', 'PROCESSING', 'ERROR'].includes(agent.status));
      assert.ok(Number.isFinite(agent.active));
      assert.ok(Number.isFinite(agent.max_concurrent));
      assert.match(agent.capacity_label, /^\d+\/\d+$/);
    }
    assert.equal(body.agents.filter((a) => a.is_fallback_agent).length, 1);
  });

  test('GET /api/agents/:id returns one agent, 404 when absent', async () => {
    const found = await api(server.baseUrl, '/api/agents/agent-tax-01');
    assert.equal(found.status, 200);
    assert.equal(found.body.name, 'Tax Compliance Agent');

    const missing = await api(server.baseUrl, '/api/agents/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'AGENT_NOT_FOUND');
  });
});

describe('error handling', () => {
  test('unknown routes return a structured 404', async () => {
    const { status, body } = await api(server.baseUrl, '/api/does-not-exist');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });
});
