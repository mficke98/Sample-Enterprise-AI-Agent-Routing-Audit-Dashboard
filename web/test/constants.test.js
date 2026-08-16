import { describe, it, expect } from 'vitest';

import {
  AGENT_STATUS_META,
  HEALTH_META,
  KNOWN_TASK_TYPES,
  MAX_STREAM_ROWS,
  OUTCOME_META,
  PRIORITIES,
  PRIORITY_META,
  TASK_STATUS_META,
  UNKNOWN_META,
  metaFor,
} from '../src/lib/constants.js';

const TABLES = {
  AGENT_STATUS_META,
  TASK_STATUS_META,
  PRIORITY_META,
  OUTCOME_META,
  HEALTH_META,
};

describe('the colour-is-never-alone invariant', () => {
  // This is the accessibility contract of the whole dashboard, enforced here
  // rather than left as a convention someone can quietly break.
  it('gives every state both a glyph and a word', () => {
    for (const [tableName, table] of Object.entries(TABLES)) {
      for (const [key, meta] of Object.entries(table)) {
        expect(meta.glyph, `${tableName}.${key} has no glyph`).toBeTruthy();
        expect(meta.label, `${tableName}.${key} has no label`).toBeTruthy();
      }
    }
  });

  it('gives every non-priority state a colour tone as the third channel', () => {
    // PRIORITY_META intentionally has no tone: priority is encoded by counting
    // triangles, which works in grayscale without a colour at all.
    for (const [tableName, table] of Object.entries(TABLES)) {
      if (table === PRIORITY_META) continue;
      for (const [key, meta] of Object.entries(table)) {
        expect(meta.tone, `${tableName}.${key} has no tone`).toBeTruthy();
      }
    }
  });

  it('makes priority countable: HIGH has more glyphs than MEDIUM than LOW', () => {
    expect(PRIORITY_META.HIGH.glyph.length).toBeGreaterThan(PRIORITY_META.MEDIUM.glyph.length);
    expect(PRIORITY_META.MEDIUM.glyph.length).toBeGreaterThan(PRIORITY_META.LOW.glyph.length);
  });

  it('does not reuse one glyph for two different meanings within a table', () => {
    for (const [tableName, table] of Object.entries(TABLES)) {
      const glyphs = Object.values(table).map((meta) => meta.glyph);
      expect(new Set(glyphs).size, `${tableName} reuses a glyph`).toBe(glyphs.length);
    }
  });
});

describe('metaFor', () => {
  it('returns the matching entry', () => {
    expect(metaFor(TASK_STATUS_META, 'COMPLETED')).toEqual(TASK_STATUS_META.COMPLETED);
  });

  it('degrades gracefully for a state the API adds later', () => {
    // Forward compatibility: a new server status must render as itself, not
    // crash the row or silently disappear.
    const meta = metaFor(TASK_STATUS_META, 'CANCELLED');
    expect(meta.glyph).toBe(UNKNOWN_META.glyph);
    expect(meta.label).toBe('CANCELLED');
  });

  it('handles missing and empty keys without throwing', () => {
    for (const value of [undefined, null, '']) {
      const meta = metaFor(TASK_STATUS_META, value);
      expect(meta.label).toBe('UNKNOWN');
      expect(meta.glyph).toBeTruthy();
    }
  });
});

describe('vocabulary matches the server contract', () => {
  it('covers exactly the four task statuses the API emits', () => {
    expect(Object.keys(TASK_STATUS_META).sort()).toEqual(
      ['COMPLETED', 'FAILED', 'PENDING', 'PROCESSING'].sort()
    );
  });

  it('covers exactly the three agent statuses the API emits', () => {
    expect(Object.keys(AGENT_STATUS_META).sort()).toEqual(['ERROR', 'IDLE', 'PROCESSING'].sort());
  });

  it('covers the three execution outcomes', () => {
    expect(Object.keys(OUTCOME_META).sort()).toEqual(['ERROR', 'SUCCESS', 'TIMEOUT'].sort());
  });

  it('covers the three health verdicts', () => {
    expect(Object.keys(HEALTH_META).sort()).toEqual(['CRITICAL', 'DEGRADED', 'HEALTHY'].sort());
  });

  it('lists the configured agent types and priorities', () => {
    expect(KNOWN_TASK_TYPES).toEqual(['TAX', 'AUDIT', 'SECURITY', 'GENERAL']);
    expect(PRIORITIES).toEqual(['HIGH', 'MEDIUM', 'LOW']);
  });

  it('bounds rendered stream rows so a console left open overnight is safe', () => {
    expect(MAX_STREAM_ROWS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_STREAM_ROWS)).toBe(true);
  });
});
