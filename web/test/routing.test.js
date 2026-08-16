import { describe, it, expect } from 'vitest';

import { describeRouting, isFallback, isTerminal } from '../src/lib/routing.js';
import { attempt, fallbackTask, task } from './fixtures.js';

describe('describeRouting - reconstructing the routing trace', () => {
  it('derives TAX -> GENERAL from the attempt history, not a server string', () => {
    // The whole point: the arrow is computed from attempts[0] vs the last
    // attempt, so it stays correct even if the server's wording changes.
    const { from, to } = describeRouting(fallbackTask());
    expect(from).toEqual({ name: 'Audit Risk Scraper', type: 'AUDIT' });
    expect(to).toEqual({ name: 'General Fallback Agent', type: 'GENERAL' });
  });

  it('reports no re-route target for a single-attempt task', () => {
    const { from, to } = describeRouting(task());
    expect(from.name).toBe('Tax Compliance Agent');
    // One attempt means nothing was re-routed; `to` falls back to the assignee.
    expect(to).toEqual({ name: 'Tax Compliance Agent', type: null });
  });

  it('falls back to the declared type before any attempt exists', () => {
    const pending = task({ status: 'PENDING', attempts: [], attempt_count: 0 });
    const { from } = describeRouting(pending);
    expect(from).toEqual({ name: 'Tax Compliance Agent', type: 'TAX' });
  });

  it('prefers the server routing_note as the reason', () => {
    expect(describeRouting(fallbackTask()).reason).toBe(
      'Re-routed from Audit Risk Scraper after failure.'
    );
  });

  it('falls back to the failing attempt error when there is no routing note', () => {
    const noNote = fallbackTask({ routing_note: null });
    expect(describeRouting(noNote).reason).toMatch(/unrecoverable inference error/);
  });

  it('never returns an empty reason, so the sub-line is never blank', () => {
    const bare = fallbackTask({ routing_note: null, attempts: [attempt({ error: null })] });
    expect(describeRouting(bare).reason).toBeTruthy();
  });

  it('tolerates a malformed attempts field instead of throwing', () => {
    // Defensive: a partial frame must not crash the row it renders.
    for (const attempts of [undefined, null, 'nope', 42, {}]) {
      expect(() => describeRouting({ ...task(), attempts })).not.toThrow();
    }
  });

  it('returns nulls for a task with no identifying information at all', () => {
    const { from, to } = describeRouting({ attempts: [] });
    expect(from).toBeNull();
    expect(to).toBeNull();
  });
});

describe('isFallback', () => {
  it('is true only when the server set the flag', () => {
    expect(isFallback(fallbackTask())).toBe(true);
    expect(isFallback(task())).toBe(false);
  });

  it('coerces missing input to false rather than throwing', () => {
    expect(isFallback(null)).toBe(false);
    expect(isFallback(undefined)).toBe(false);
    expect(isFallback({})).toBe(false);
  });
});

describe('isTerminal', () => {
  it('treats COMPLETED and FAILED as terminal', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(true);
  });

  it('treats in-flight states as non-terminal', () => {
    expect(isTerminal('PENDING')).toBe(false);
    expect(isTerminal('PROCESSING')).toBe(false);
  });

  it('treats an unknown future state as non-terminal', () => {
    expect(isTerminal('CANCELLED')).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
  });
});
