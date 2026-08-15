import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { stripJsonComments, parseJsonc, readJsonc } from '../src/lib/jsonc.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..');

describe('stripJsonComments', () => {
  test('removes a leading line comment (the exact defect in the provided seed files)', () => {
    const input = '// agents_config.json\n[{"id":"a"}]';
    assert.deepEqual(JSON.parse(stripJsonComments(input)), [{ id: 'a' }]);
  });

  test('removes trailing line comments after a value', () => {
    const input = '{\n  "a": 1, // first\n  "b": 2  // second\n}';
    assert.deepEqual(JSON.parse(stripJsonComments(input)), { a: 1, b: 2 });
  });

  test('removes block comments', () => {
    const input = '{ /* header */ "a": 1 }';
    assert.deepEqual(JSON.parse(stripJsonComments(input)), { a: 1 });
  });

  test('block comment removal does not glue tokens together', () => {
    // Naive replacement with '' would turn this into `12`, silently changing the value.
    assert.equal(stripJsonComments('[1/* x */,2]').replace(/\s+/g, ''), '[1,2]');
  });

  test('PRESERVES // inside string values (URLs must survive)', () => {
    const input = '{"url":"https://example.com/path","note":"a // b"}';
    const parsed = JSON.parse(stripJsonComments(input));
    assert.equal(parsed.url, 'https://example.com/path');
    assert.equal(parsed.note, 'a // b');
  });

  test('preserves /* */ inside string values', () => {
    const parsed = JSON.parse(stripJsonComments('{"glob":"/* not a comment */"}'));
    assert.equal(parsed.glob, '/* not a comment */');
  });

  test('handles escaped quotes without losing string context', () => {
    const input = '{"quote":"she said \\"hi // there\\"","after":1}';
    const parsed = JSON.parse(stripJsonComments(input));
    assert.equal(parsed.quote, 'she said "hi // there"');
    assert.equal(parsed.after, 1);
  });

  test('handles an escaped backslash immediately before the closing quote', () => {
    // "path\\" ends the string; a naive escape tracker would think it continues.
    const parsed = JSON.parse(stripJsonComments('{"path":"C:\\\\","x":2}'));
    assert.equal(parsed.path, 'C:\\');
    assert.equal(parsed.x, 2);
  });

  test('unterminated block comment does not hang or throw', () => {
    assert.doesNotThrow(() => stripJsonComments('{"a":1} /* never closed'));
  });

  test('is a no-op on comment-free JSON', () => {
    const clean = '{"a":[1,2,3],"b":{"c":null}}';
    assert.equal(stripJsonComments(clean), clean);
  });

  test('handles empty input', () => {
    assert.equal(stripJsonComments(''), '');
  });
});

describe('parseJsonc', () => {
  test('strips a UTF-8 BOM', () => {
    assert.deepEqual(parseJsonc('\uFEFF{"a":1}'), { a: 1 });
  });

  test('error message names the source for debuggability', () => {
    assert.throws(
      () => parseJsonc('{ not json', 'seed.json'),
      (err) => err.message.includes('seed.json'),
    );
  });
});

describe('reading the real provided seed files', () => {
  test('agents_config.json loads and has the 4 expected agents', () => {
    const agents = readJsonc(join(projectRoot, 'agents_config.json'));
    assert.equal(agents.length, 4);
    assert.deepEqual(
      agents.map((a) => a.type).sort(),
      ['AUDIT', 'GENERAL', 'SECURITY', 'TAX'],
    );
    // Fields the routing/cost logic depends on must all be present.
    for (const agent of agents) {
      assert.ok(agent.id, 'agent needs an id');
      assert.ok(Number.isFinite(agent.max_concurrent), 'agent needs max_concurrent');
      assert.ok(Number.isFinite(agent.cost_per_1k_tokens), 'agent needs cost_per_1k_tokens');
    }
  });

  test('exactly one GENERAL agent exists to serve as the fallback target', () => {
    const agents = readJsonc(join(projectRoot, 'agents_config.json'));
    assert.equal(agents.filter((a) => a.type === 'GENERAL').length, 1);
  });

  test('sample_tasks.json loads and has the 3 expected tasks', () => {
    const tasks = readJsonc(join(projectRoot, 'sample_tasks.json'));
    assert.equal(tasks.length, 3);
    assert.deepEqual(tasks.map((t) => t.type), ['TAX', 'SECURITY', 'AUDIT']);
  });

  test('raw seed files really are invalid JSON without stripping (guards the premise)', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(join(projectRoot, 'agents_config.json'), 'utf8');
    assert.throws(() => JSON.parse(raw), SyntaxError);
  });

  test('missing file produces a clear error rather than a raw ENOENT stack', () => {
    assert.throws(
      () => readJsonc(join(projectRoot, 'does_not_exist.json')),
      (err) => err.message.includes('Could not read'),
    );
  });
});
