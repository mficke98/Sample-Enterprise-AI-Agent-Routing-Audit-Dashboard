import { describe, it, expect } from 'vitest';

import {
  DASH,
  formatClock,
  formatConfidence,
  formatCount,
  formatLatency,
  formatPercent,
  formatRate1k,
  formatTokens,
  formatUsd,
} from '../src/lib/format.js';

/** Everything a formatter must survive without emitting "NaN" or "undefined". */
const JUNK = [null, undefined, NaN, Infinity, -Infinity, 'abc', '', {}, [], true, false];

describe('formatLatency', () => {
  it('always uses milliseconds and never promotes to seconds', () => {
    // A unit that changes at some threshold changes the string width, which
    // reflows the row. 90 seconds stays in ms.
    expect(formatLatency(1284)).toBe('1284 ms');
    expect(formatLatency(90000)).toBe('90000 ms');
    expect(formatLatency(0)).toBe('0 ms');
  });

  it('rounds to an integer', () => {
    expect(formatLatency(1284.6)).toBe('1285 ms');
    expect(formatLatency(0.4)).toBe('0 ms');
  });

  it('returns a dash for every non-finite input', () => {
    for (const value of JUNK) expect(formatLatency(value)).toBe(DASH);
  });
});

describe('formatUsd', () => {
  it('pins four decimal places so the string width never changes', () => {
    expect(formatUsd(0.0143)).toBe('$0.0143');
    expect(formatUsd(1)).toBe('$1.0000');
    expect(formatUsd(0)).toBe('$0.0000');
  });

  it('keeps a constant character count across magnitudes at fixed decimals', () => {
    const values = [0.0001, 0.5, 0.9999].map((v) => formatUsd(v).length);
    expect(new Set(values).size).toBe(1);
  });

  it('honours an explicit decimal count', () => {
    expect(formatUsd(0.015, 3)).toBe('$0.015');
  });

  it('returns a dash rather than $NaN', () => {
    for (const value of JUNK) expect(formatUsd(value)).toBe(DASH);
  });
});

describe('formatCount and formatTokens', () => {
  it('renders plain integers', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(168)).toBe('168');
    expect(formatCount(3.7)).toBe('4');
  });

  it('groups large token counts for readability', () => {
    expect(formatTokens(25840)).toBe('25,840');
    expect(formatTokens(999)).toBe('999');
  });

  it('returns a dash for junk', () => {
    for (const value of JUNK) {
      expect(formatCount(value)).toBe(DASH);
      expect(formatTokens(value)).toBe(DASH);
    }
  });
});

describe('formatPercent', () => {
  it('converts a 0..1 fraction to one decimal place', () => {
    expect(formatPercent(0.9697)).toBe('97.0%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(0.5)).toBe('50.0%');
  });

  it('shows a dash rather than a catastrophic-looking 0.0% when nothing has run', () => {
    // The API honestly reports success_rate: 0 on an empty system. Rendering
    // "0.0%" would read as total failure rather than "nothing has happened".
    expect(formatPercent(0, false)).toBe(DASH);
    expect(formatPercent(0.9, false)).toBe(DASH);
  });

  it('renders a genuine 0% once there are samples', () => {
    expect(formatPercent(0, true)).toBe('0.0%');
  });

  it('returns a dash for junk even when samples exist', () => {
    for (const value of JUNK) expect(formatPercent(value, true)).toBe(DASH);
  });
});

describe('formatConfidence', () => {
  it('renders two decimals', () => {
    expect(formatConfidence(0.913)).toBe('0.91');
    expect(formatConfidence(1)).toBe('1.00');
  });

  it('dashes a null confidence (which is what a failed attempt carries)', () => {
    expect(formatConfidence(null)).toBe(DASH);
  });
});

describe('formatRate1k', () => {
  it('renders an agent price card', () => {
    expect(formatRate1k(0.015)).toBe('$0.015 / 1k');
    expect(formatRate1k(0.008)).toBe('$0.008 / 1k');
  });

  it('dashes junk', () => {
    for (const value of JUNK) expect(formatRate1k(value)).toBe(DASH);
  });
});

describe('formatClock', () => {
  it('renders 24-hour wall clock time', () => {
    expect(formatClock('2026-08-15T14:03:27.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('returns a dash for a missing or unparseable timestamp', () => {
    expect(formatClock(null)).toBe(DASH);
    expect(formatClock(undefined)).toBe(DASH);
    expect(formatClock('')).toBe(DASH);
    expect(formatClock('not-a-date')).toBe(DASH);
  });
});

describe('the no-NaN invariant across every formatter', () => {
  const formatters = {
    formatLatency,
    formatUsd,
    formatCount,
    formatTokens,
    formatConfidence,
    formatRate1k,
    formatClock,
  };

  it('never emits NaN, undefined or Infinity for any junk input', () => {
    for (const [name, fn] of Object.entries(formatters)) {
      for (const value of JUNK) {
        const output = String(fn(value));
        expect(output, `${name}(${String(value)})`).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });
});
