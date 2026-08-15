import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { validateTaskInput } from '../src/domain/validation.js';
import { withConfig, VALID_TASK } from './helpers.js';

const fieldsWithErrors = (result) => result.errors.map((e) => e.field);

describe('validateTaskInput - happy path', () => {
  test('accepts a well-formed task', () => {
    const result = validateTaskInput(VALID_TASK);
    assert.equal(result.valid, true);
    assert.deepEqual(result.value, {
      title: VALID_TASK.title,
      type: 'TAX',
      payload: VALID_TASK.payload,
      priority: 'HIGH',
    });
  });

  test('accepts every sample task from the provided sample_tasks.json shape', () => {
    const samples = [
      { title: 'A', type: 'TAX', payload: 'p', priority: 'HIGH' },
      { title: 'B', type: 'SECURITY', payload: 'p', priority: 'MEDIUM' },
      { title: 'C', type: 'AUDIT', payload: 'p', priority: 'HIGH' },
    ];
    for (const sample of samples) {
      assert.equal(validateTaskInput(sample).valid, true, `${sample.title} should validate`);
    }
  });

  test('trims surrounding whitespace', () => {
    const result = validateTaskInput({ ...VALID_TASK, title: '  Padded  ', payload: '  body  ' });
    assert.equal(result.value.title, 'Padded');
    assert.equal(result.value.payload, 'body');
  });

  test('normalises type and priority casing', () => {
    const result = validateTaskInput({ ...VALID_TASK, type: 'tax', priority: 'high' });
    assert.equal(result.value.type, 'TAX');
    assert.equal(result.value.priority, 'HIGH');
  });
});

describe('validateTaskInput - required fields', () => {
  test('rejects a missing title', () => {
    const result = validateTaskInput({ payload: 'x' });
    assert.equal(result.valid, false);
    assert.ok(fieldsWithErrors(result).includes('title'));
  });

  test('rejects a whitespace-only title (not just an empty string)', () => {
    const result = validateTaskInput({ ...VALID_TASK, title: '     ' });
    assert.equal(result.valid, false);
    assert.ok(fieldsWithErrors(result).includes('title'));
  });

  test('rejects a missing payload', () => {
    const result = validateTaskInput({ title: 'x' });
    assert.equal(result.valid, false);
    assert.ok(fieldsWithErrors(result).includes('payload'));
  });

  test('rejects non-string title and payload types', () => {
    for (const bad of [42, true, {}, [], null]) {
      const result = validateTaskInput({ title: bad, payload: bad });
      assert.equal(result.valid, false, `${JSON.stringify(bad)} should be rejected`);
    }
  });

  test('reports every problem at once rather than one at a time', () => {
    const result = validateTaskInput({ priority: 'URGENT' });
    const fields = fieldsWithErrors(result);
    assert.ok(fields.includes('title'));
    assert.ok(fields.includes('payload'));
    assert.ok(fields.includes('priority'));
    assert.equal(fields.length, 3);
  });

  test('rejects a non-object body', () => {
    for (const bad of [null, 'string', 42, ['array']]) {
      const result = validateTaskInput(bad);
      assert.equal(result.valid, false);
      assert.equal(result.errors[0].field, 'body');
    }
  });
});

describe('validateTaskInput - size limits', () => {
  let restore;
  afterEach(() => restore?.());

  test('rejects an over-long payload', () => {
    restore = withConfig({ maxPayloadChars: 50 });
    const result = validateTaskInput({ ...VALID_TASK, payload: 'x'.repeat(51) });
    assert.equal(result.valid, false);
    assert.ok(fieldsWithErrors(result).includes('payload'));
  });

  test('accepts a payload exactly at the limit (boundary is inclusive)', () => {
    restore = withConfig({ maxPayloadChars: 50 });
    assert.equal(validateTaskInput({ ...VALID_TASK, payload: 'x'.repeat(50) }).valid, true);
  });

  test('rejects an over-long title', () => {
    restore = withConfig({ maxTitleChars: 10 });
    const result = validateTaskInput({ ...VALID_TASK, title: 'x'.repeat(11) });
    assert.equal(result.valid, false);
    assert.ok(fieldsWithErrors(result).includes('title'));
  });
});

describe('validateTaskInput - priority is strict, type is permissive', () => {
  test('defaults priority to MEDIUM when omitted', () => {
    const { title, type, payload } = VALID_TASK;
    assert.equal(validateTaskInput({ title, type, payload }).value.priority, 'MEDIUM');
  });

  test('rejects an invalid priority, listing the valid options', () => {
    const result = validateTaskInput({ ...VALID_TASK, priority: 'URGENT' });
    assert.equal(result.valid, false);
    assert.match(result.errors.find((e) => e.field === 'priority').message, /HIGH, MEDIUM, LOW/);
  });

  test('ACCEPTS an unknown type - it will route to GENERAL rather than 400', () => {
    const result = validateTaskInput({ ...VALID_TASK, type: 'CRYPTO_FORENSICS' });
    assert.equal(result.valid, true, 'an ingestion endpoint should absorb new document categories');
    assert.equal(result.value.type, 'CRYPTO_FORENSICS');
  });

  test('defaults type to GENERAL when omitted', () => {
    const { title, payload } = VALID_TASK;
    assert.equal(validateTaskInput({ title, payload }).value.type, 'GENERAL');
  });

  test('rejects an empty-string type as a likely client bug', () => {
    const result = validateTaskInput({ ...VALID_TASK, type: '   ' });
    assert.equal(result.valid, false);
    assert.ok(fieldsWithErrors(result).includes('type'));
  });

  test('ignores unknown extra fields rather than rejecting them', () => {
    const result = validateTaskInput({ ...VALID_TASK, client_ref: 'ACME-2024', nested: { a: 1 } });
    assert.equal(result.valid, true);
    assert.equal(result.value.client_ref, undefined, 'extras must not leak into the stored record');
  });
});
