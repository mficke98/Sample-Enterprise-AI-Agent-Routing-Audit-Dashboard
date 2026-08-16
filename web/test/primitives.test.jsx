import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CapacityMeter } from '../src/components/CapacityMeter.jsx';
import { Num } from '../src/components/Num.jsx';
import { PriorityTag } from '../src/components/PriorityTag.jsx';
import { StatePill } from '../src/components/StatePill.jsx';
import { AGENT_STATUS_META, PRIORITY_META, TASK_STATUS_META } from '../src/lib/constants.js';

describe('Num - the anti-jitter wrapper', () => {
  it('applies the reserved width bucket so a changing value cannot reflow the row', () => {
    const { container } = render(<Num w={8}>1284 ms</Num>);
    const el = container.querySelector('.num');
    expect(el).toHaveClass('num--w8');
    expect(el).toHaveTextContent('1284 ms');
  });

  it('defaults to the 6ch bucket', () => {
    const { container } = render(<Num>168</Num>);
    expect(container.querySelector('.num')).toHaveClass('num--w6');
  });

  it('applies a semantic tone only when asked', () => {
    const { container: withTone } = render(<Num tone="muted">—</Num>);
    expect(withTone.querySelector('.num')).toHaveClass('tone-muted');

    const { container: without } = render(<Num>1</Num>);
    expect(without.querySelector('.num').className).not.toMatch(/tone-/);
  });

  it('merges a caller className without dropping its own', () => {
    const { container } = render(<Num className="row__latency">x</Num>);
    const el = container.querySelector('.num');
    expect(el).toHaveClass('num');
    expect(el).toHaveClass('row__latency');
  });

  it('forwards arbitrary props such as title', () => {
    render(<Num title="processing latency">1284 ms</Num>);
    expect(screen.getByTitle('processing latency')).toBeInTheDocument();
  });
});

describe('StatePill - glyph, word and colour', () => {
  it.each(Object.entries(TASK_STATUS_META))('renders the %s glyph and label', (value, meta) => {
    const { container } = render(<StatePill table={TASK_STATUS_META} value={value} />);
    expect(container.querySelector('.pill')).toHaveClass(`tone-${meta.tone}`);
    expect(container.querySelector('.pill__glyph')).toHaveTextContent(meta.glyph);
    expect(container.querySelector('.pill__label')).toHaveTextContent(meta.label);
  });

  it('hides the glyph from assistive tech, since the word carries the meaning', () => {
    const { container } = render(<StatePill table={AGENT_STATUS_META} value="PROCESSING" />);
    expect(container.querySelector('.pill__glyph')).toHaveAttribute('aria-hidden', 'true');
    // The label is NOT hidden -- a screen reader must still hear the state.
    expect(container.querySelector('.pill__label')).not.toHaveAttribute('aria-hidden');
  });

  it('renders an unknown status as itself rather than blank', () => {
    const { container } = render(<StatePill table={TASK_STATUS_META} value="CANCELLED" />);
    expect(container.querySelector('.pill__label')).toHaveTextContent('CANCELLED');
  });

  it('never renders an empty pill for a missing value', () => {
    const { container } = render(<StatePill table={TASK_STATUS_META} value={undefined} />);
    expect(container.querySelector('.pill').textContent.trim()).not.toBe('');
  });
});

describe('PriorityTag - countable triangles', () => {
  it.each([
    ['HIGH', 3],
    ['MEDIUM', 2],
    ['LOW', 1],
  ])('renders %s as %i triangle(s)', (value, count) => {
    const { container } = render(<PriorityTag value={value} />);
    const glyph = container.querySelector('.prio__glyph').textContent;
    expect([...glyph].filter((ch) => ch === '▲')).toHaveLength(count);
    expect(glyph).toBe(PRIORITY_META[value].glyph);
  });

  it('gives screen readers the word, since triangles are visual-only', () => {
    render(<PriorityTag value="HIGH" />);
    expect(screen.getByText('Priority HIGH')).toBeInTheDocument();
  });

  it('marks only HIGH for emphasis', () => {
    const { container: high } = render(<PriorityTag value="HIGH" />);
    expect(high.querySelector('.prio')).toHaveClass('prio--high');

    const { container: medium } = render(<PriorityTag value="MEDIUM" />);
    expect(medium.querySelector('.prio')).not.toHaveClass('prio--high');
  });

  it('exposes the priority as a tooltip', () => {
    render(<PriorityTag value="LOW" />);
    expect(screen.getByTitle('Priority: LOW')).toBeInTheDocument();
  });
});

describe('CapacityMeter - discrete slots, not a percentage bar', () => {
  it('renders one segment per configured slot', () => {
    const { container } = render(<CapacityMeter active={2} max={5} />);
    expect(container.querySelectorAll('.slot')).toHaveLength(5);
    expect(container.querySelectorAll('.slot--filled')).toHaveLength(2);
  });

  it('announces the state as one sentence, not eight anonymous divs', () => {
    render(<CapacityMeter active={2} max={3} />);
    const strip = screen.getByRole('img');
    expect(strip).toHaveAttribute('aria-label', '2 of 3 slots in use');
    // Individual segments must be hidden or a screen reader reads noise.
    strip.querySelectorAll('.slot').forEach((slot) => {
      expect(slot).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('shows AT CAPACITY only when saturated', () => {
    const { queryByText } = render(<CapacityMeter active={1} max={3} />);
    expect(queryByText('AT CAPACITY')).toBeNull();

    render(<CapacityMeter active={3} max={3} />);
    expect(screen.getByText('AT CAPACITY')).toBeInTheDocument();
  });

  it('marks the strip as full so the colour shift is not the only signal', () => {
    const { container } = render(<CapacityMeter active={2} max={2} />);
    expect(container.querySelector('.capacity__slots')).toHaveClass('capacity__slots--full');
  });

  it('renders the numeric label redundantly with the segments', () => {
    const { container } = render(<CapacityMeter active={4} max={5} />);
    expect(container.querySelector('.capacity__label')).toHaveTextContent('4/5');
  });

  it('clamps an over-count rather than rendering more filled slots than exist', () => {
    // Defensive against a bad frame: active must never exceed max_concurrent,
    // but the UI should degrade gracefully rather than render garbage.
    const { container } = render(<CapacityMeter active={9} max={3} />);
    expect(container.querySelectorAll('.slot')).toHaveLength(3);
    expect(container.querySelectorAll('.slot--filled')).toHaveLength(3);
    expect(container.querySelector('.capacity__label')).toHaveTextContent('3/3');
  });

  it('clamps a negative active count to zero', () => {
    const { container } = render(<CapacityMeter active={-4} max={3} />);
    expect(container.querySelectorAll('.slot--filled')).toHaveLength(0);
    expect(container.querySelector('.capacity__label')).toHaveTextContent('0/3');
  });

  it('renders nothing pathological with no props at all', () => {
    const { container } = render(<CapacityMeter />);
    expect(container.querySelectorAll('.slot')).toHaveLength(0);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '0 of 0 slots in use');
    // A zero-capacity agent is not "at capacity"; it is unconfigured.
    expect(container.querySelector('.capacity__flag')).toBeNull();
  });
});
