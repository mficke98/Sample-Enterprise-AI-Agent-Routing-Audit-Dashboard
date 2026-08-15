import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../src/lib/rng.js';

describe('createRng', () => {
  test('same seed produces an identical sequence (reproducible tests/demos)', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    assert.deepEqual(seqA, seqB);
  });

  test('different seeds diverge', () => {
    const a = Array.from({ length: 10 }, createRng(1).next);
    const b = Array.from({ length: 10 }, createRng(2).next);
    assert.notDeepEqual(a, b);
  });

  test('output stays within [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next();
      assert.ok(value >= 0 && value < 1, `out of range: ${value}`);
    }
  });

  test('unseeded falls back to Math.random and still returns valid floats', () => {
    const rng = createRng(null);
    for (let i = 0; i < 100; i += 1) {
      const value = rng.next();
      assert.ok(value >= 0 && value < 1);
    }
  });

  describe('chance', () => {
    test('p=0 is never true, p=1 is always true (no dice roll consumed at the extremes)', () => {
      const rng = createRng(3);
      for (let i = 0; i < 200; i += 1) {
        assert.equal(rng.chance(0), false);
        assert.equal(rng.chance(1), true);
      }
    });

    test('negative and >1 probabilities are clamped, not undefined behaviour', () => {
      const rng = createRng(3);
      assert.equal(rng.chance(-5), false);
      assert.equal(rng.chance(99), true);
    });

    test('p=0.1 lands near 10% over a large sample', () => {
      const rng = createRng(2024);
      let hits = 0;
      const runs = 20000;
      for (let i = 0; i < runs; i += 1) if (rng.chance(0.1)) hits += 1;
      const rate = hits / runs;
      assert.ok(rate > 0.085 && rate < 0.115, `expected ~0.10, got ${rate}`);
    });
  });

  describe('nextInt', () => {
    test('is inclusive of both bounds and never exceeds them', () => {
      const rng = createRng(11);
      let sawMin = false;
      let sawMax = false;
      for (let i = 0; i < 2000; i += 1) {
        const value = rng.nextInt(1, 3);
        assert.ok(value >= 1 && value <= 3, `out of range: ${value}`);
        assert.ok(Number.isInteger(value));
        if (value === 1) sawMin = true;
        if (value === 3) sawMax = true;
      }
      assert.ok(sawMin && sawMax, 'should reach both bounds');
    });

    test('degenerate range returns the bound instead of NaN', () => {
      const rng = createRng(5);
      assert.equal(rng.nextInt(4, 4), 4);
      assert.equal(rng.nextInt(9, 2), 9);
    });
  });

  test('pick always returns a member of the array', () => {
    const rng = createRng(8);
    const items = ['TIMEOUT', 'ERROR'];
    for (let i = 0; i < 500; i += 1) {
      assert.ok(items.includes(rng.pick(items)));
    }
  });
});
