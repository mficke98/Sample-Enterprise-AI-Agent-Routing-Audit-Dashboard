import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MetricsPanel } from '../src/components/MetricsPanel.jsx';
import { emptyMetrics, metrics } from './fixtures.js';

const cardByLabel = (container, label) =>
  [...container.querySelectorAll('.card.metric')].find(
    (card) => card.querySelector('.metric__label')?.textContent === label
  );

describe('MetricsPanel - before the first snapshot', () => {
  it('renders all five cards with metrics === null', () => {
    const { container } = render(<MetricsPanel metrics={null} />);
    expect(container.querySelectorAll('.card.metric')).toHaveLength(5);
    for (const label of ['Total Tasks', 'Success Rate', 'Avg Latency', 'Total Cost', 'System Health']) {
      expect(cardByLabel(container, label)).toBeTruthy();
    }
  });

  it('never renders NaN or undefined anywhere', () => {
    const { container } = render(<MetricsPanel metrics={null} />);
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('shows a dash for health rather than inventing a verdict', () => {
    const { container } = render(<MetricsPanel metrics={null} />);
    const health = cardByLabel(container, 'System Health');
    expect(health.querySelector('.health__word')).toHaveTextContent('—');
    expect(health).toHaveTextContent('Awaiting first snapshot.');
  });

  it('tolerates a partial metrics object with missing sections', () => {
    const { container } = render(<MetricsPanel metrics={{ totals: { tasks: 4 } }} />);
    expect(container.textContent).not.toMatch(/NaN|undefined/);
    expect(cardByLabel(container, 'Total Tasks')).toHaveTextContent('4');
  });
});

describe('MetricsPanel - the empty system', () => {
  it('shows a dash for success rate, not a catastrophic 0.0%', () => {
    // The API honestly reports success_rate: 0 with nothing processed.
    // Rendering "0.0%" would read as total failure on a healthy new server.
    const { container } = render(<MetricsPanel metrics={emptyMetrics()} />);
    expect(cardByLabel(container, 'Success Rate').querySelector('.metric__value')).toHaveTextContent('—');
  });

  it('shows a dash for latency when there are no samples', () => {
    const { container } = render(<MetricsPanel metrics={emptyMetrics()} />);
    const card = cardByLabel(container, 'Avg Latency');
    expect(card.querySelector('.metric__value')).toHaveTextContent('—');
    // p95/min/max are dashed too, rather than reporting a fabricated 0 ms.
    expect(card).toHaveTextContent(/p95\s*—/);
  });

  it('reports HEALTHY on a fresh server, not CRITICAL', () => {
    const { container } = render(<MetricsPanel metrics={emptyMetrics()} />);
    const health = cardByLabel(container, 'System Health');
    expect(health.querySelector('.health__word')).toHaveTextContent('HEALTHY');
    expect(health).toHaveTextContent('No tasks processed yet.');
  });

  it('still shows real zeros for genuinely countable things', () => {
    const { container } = render(<MetricsPanel metrics={emptyMetrics()} />);
    expect(cardByLabel(container, 'Total Tasks').querySelector('.metric__value')).toHaveTextContent('0');
    expect(cardByLabel(container, 'Total Cost').querySelector('.metric__value')).toHaveTextContent('$0.0000');
  });

  it('emits no NaN for the empty system either', () => {
    const { container } = render(<MetricsPanel metrics={emptyMetrics()} />);
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('MetricsPanel - a populated system', () => {
  it('renders the headline figures', () => {
    const { container } = render(<MetricsPanel metrics={metrics()} />);
    expect(cardByLabel(container, 'Total Tasks').querySelector('.metric__value')).toHaveTextContent('168');
    expect(cardByLabel(container, 'Success Rate').querySelector('.metric__value')).toHaveTextContent('97.0%');
    expect(cardByLabel(container, 'Avg Latency').querySelector('.metric__value')).toHaveTextContent('1284 ms');
    expect(cardByLabel(container, 'Total Cost').querySelector('.metric__value')).toHaveTextContent('$0.4471');
  });

  it('breaks total tasks down by status', () => {
    const { container } = render(<MetricsPanel metrics={metrics()} />);
    const card = cardByLabel(container, 'Total Tasks');
    expect(card).toHaveTextContent(/2\s*pending/);
    expect(card).toHaveTextContent(/1\s*running/);
    expect(card).toHaveTextContent(/160\s*done/);
    expect(card).toHaveTextContent(/5\s*failed/);
  });

  it('shows fallbacks as a RATIO, never a bare count', () => {
    // "7" alone is meaningless; "7 of 168 · 4.2%" says whether routing is
    // healthy or quietly degrading.
    const { container } = render(<MetricsPanel metrics={metrics()} />);
    const card = cardByLabel(container, 'Success Rate');
    expect(card).toHaveTextContent('7 of 168');
    expect(card).toHaveTextContent('4.2%');
  });

  it('surfaces queue depth and waiting high-priority work', () => {
    const { container } = render(<MetricsPanel metrics={metrics()} />);
    const card = cardByLabel(container, 'Total Tasks');
    expect(card).toHaveTextContent(/queue\s*2/);
    expect(card).toHaveTextContent(/high\s*1/);
  });

  it('shows latency percentiles alongside the average', () => {
    const { container } = render(<MetricsPanel metrics={metrics()} />);
    const card = cardByLabel(container, 'Avg Latency');
    expect(card).toHaveTextContent('2810 ms');
    expect(card).toHaveTextContent('902 ms');
    expect(card).toHaveTextContent('3102 ms');
  });

  it('computes average cost per task', () => {
    const { container } = render(<MetricsPanel metrics={metrics()} />);
    expect(cardByLabel(container, 'Total Cost')).toHaveTextContent('$0.0027');
  });

  it('groups large token counts', () => {
    const { container } = render(<MetricsPanel metrics={metrics()} />);
    expect(cardByLabel(container, 'Total Cost')).toHaveTextContent('25,840');
  });
});

describe('MetricsPanel - health verdicts', () => {
  it.each([
    ['HEALTHY', 'success', '✓'],
    ['DEGRADED', 'warn', '△'],
    ['CRITICAL', 'error', '✕'],
  ])('renders %s with a glyph and word, not colour alone', (status, tone, glyph) => {
    const { container } = render(
      <MetricsPanel metrics={metrics({ system_health: { status, reason: 'because', agents_in_error: 0 } })} />
    );
    const health = cardByLabel(container, 'System Health');
    expect(health.querySelector('.health')).toHaveClass(`tone-${tone}`);
    expect(health.querySelector('.health__glyph')).toHaveTextContent(glyph);
    expect(health.querySelector('.health__word')).toHaveTextContent(status);
  });

  it('shows the reason so the verdict is explained, not just asserted', () => {
    const { container } = render(
      <MetricsPanel
        metrics={metrics({
          system_health: { status: 'DEGRADED', reason: '1 agent(s) currently in ERROR: Audit Risk Scraper.', agents_in_error: 1 },
        })}
      />
    );
    expect(cardByLabel(container, 'System Health')).toHaveTextContent(/Audit Risk Scraper/);
  });

  it('renders an unrecognised future verdict as itself', () => {
    const { container } = render(
      <MetricsPanel metrics={metrics({ system_health: { status: 'MAINTENANCE', reason: 'x' } })} />
    );
    expect(cardByLabel(container, 'System Health').querySelector('.health__word')).toHaveTextContent(
      'MAINTENANCE'
    );
  });

  it('labels the region for assistive tech', () => {
    render(<MetricsPanel metrics={metrics()} />);
    expect(screen.getByLabelText('System metrics')).toBeInTheDocument();
  });
});
