import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TaskRow } from '../src/components/TaskRow.jsx';
import { fallbackTask, task } from './fixtures.js';

const renderRow = (t, props = {}) =>
  render(<TaskRow task={t} expanded={false} onToggle={() => {}} {...props} />);

describe('TaskRow - a normal (non-fallback) task', () => {
  it('shows the type tag and owning agent', () => {
    const { container } = renderRow(task());
    expect(container.querySelector('.tag--type')).toHaveTextContent('TAX');
    expect(container.querySelector('.row__agentname')).toHaveTextContent('Tax Compliance Agent');
  });

  it('carries none of the fallback treatment', () => {
    const { container } = renderRow(task());
    expect(container.querySelector('.row')).not.toHaveClass('row--fallback');
    expect(container.querySelector('.chip--fallback')).toBeNull();
    expect(container.querySelector('.route')).toBeNull();
    expect(container.querySelector('.row__reroute')).toBeNull();
  });

  it('renders latency and cost through the fixed-width formatters', () => {
    const { container } = renderRow(task());
    expect(container.querySelector('.row__latency')).toHaveTextContent('1284 ms');
    expect(container.querySelector('.row__cost')).toHaveTextContent('$0.0023');
  });

  it('shows a dash, never NaN, for a task that has not run yet', () => {
    const { container } = renderRow(
      task({ status: 'PENDING', latency_ms: null, total_cost_usd: null, attempts: [] })
    );
    expect(container.querySelector('.row__latency')).toHaveTextContent('—');
    expect(container.querySelector('.row__cost')).toHaveTextContent('—');
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it('falls back to "unassigned" rather than rendering a blank agent', () => {
    const { container } = renderRow(task({ assigned_agent_name: null, attempts: [] }));
    expect(container.querySelector('.row__agentname')).toHaveTextContent('unassigned');
  });
});

describe('TaskRow - the fallback treatment (five redundant signals)', () => {
  it('SIGNAL 1: marks the row so the left rule and hatch apply', () => {
    const { container } = renderRow(fallbackTask());
    expect(container.querySelector('.row')).toHaveClass('row--fallback');
  });

  it('SIGNAL 2/3: renders the FALLBACK chip with its glyph', () => {
    const { container } = renderRow(fallbackTask());
    const chip = container.querySelector('.chip--fallback');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('FALLBACK');
    expect(chip).toHaveTextContent('↩');
  });

  it('SIGNAL 4: renders the routing trace AUDIT -> GENERAL', () => {
    const { container } = renderRow(fallbackTask());
    expect(container.querySelector('.route__from')).toHaveTextContent('AUDIT');
    expect(container.querySelector('.route__to')).toHaveTextContent('GENERAL');
    expect(container.querySelector('.route__arrow')).toHaveTextContent('⟶');
  });

  it('SIGNAL 5: explains the re-route in plain language', () => {
    const { container } = renderRow(fallbackTask());
    const line = container.querySelector('.row__reroute');
    expect(line).toBeInTheDocument();
    expect(line).toHaveTextContent(/Rerouted/);
    expect(line).toHaveTextContent(/Audit Risk Scraper/);
  });

  it('gives the full agent names as tooltips, since the trace shows short types', () => {
    renderRow(fallbackTask());
    expect(screen.getByTitle('Audit Risk Scraper')).toBeInTheDocument();
    expect(screen.getByTitle('General Fallback Agent')).toBeInTheDocument();
  });

  it('hides the decorative arrow but exposes the re-route to screen readers', () => {
    const { container } = renderRow(fallbackTask());
    expect(container.querySelector('.route__arrow')).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.getByText('re-routed from Audit Risk Scraper to General Fallback Agent')
    ).toBeInTheDocument();
  });

  it('replaces the plain agent line, so the two treatments never both show', () => {
    const { container } = renderRow(fallbackTask());
    expect(container.querySelector('.row__agent')).toBeNull();
  });

  it('sums the cost of BOTH attempts, because the task really cost twice', () => {
    const { container } = renderRow(fallbackTask());
    expect(container.querySelector('.row__cost')).toHaveTextContent('$0.0031');
    expect(container.querySelector('.row__latency')).toHaveTextContent('2416 ms');
  });
});

describe('TaskRow - accessibility', () => {
  it('names the row as one coherent sentence for assistive tech', () => {
    renderRow(task());
    expect(
      screen.getByText(
        /Q3 Corporate Tax Exemption Verification\. COMPLETED\. Agent Tax Compliance Agent\./
      )
    ).toBeInTheDocument();
  });

  it('states "Fallback applied" in the accessible name, not only in colour', () => {
    renderRow(fallbackTask());
    expect(screen.getByText(/Fallback applied\./)).toBeInTheDocument();
  });

  it('exposes the row as an expandable control', async () => {
    const onToggle = vi.fn();
    renderRow(task(), { onToggle });
    const button = screen.getByRole('button');

    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'detail-task-0001');

    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith('task-0001');
  });

  it('reflects the expanded state and reveals the detail panel', () => {
    const { container } = renderRow(task(), { expanded: true });
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.row')).toHaveClass('row--expanded');
    expect(container.querySelector('#detail-task-0001')).toBeInTheDocument();
  });

  it('does not render the detail panel while collapsed', () => {
    const { container } = renderRow(task(), { expanded: false });
    expect(container.querySelector('#detail-task-0001')).toBeNull();
  });

  it('renders the priority glyphs and the status pill together', () => {
    const { container } = renderRow(task({ priority: 'HIGH', status: 'FAILED' }));
    expect(container.querySelector('.prio__glyph')).toHaveTextContent('▲▲▲');
    expect(container.querySelector('.pill__label')).toHaveTextContent('FAILED');
  });
});

describe('TaskRow - the one-shot terminal flash', () => {
  it('does not flash on first render of an already-terminal task', () => {
    // Otherwise every row flashes on initial hydration, which turns a snapshot
    // of 200 completed tasks into a strobe.
    const { container } = renderRow(task({ status: 'COMPLETED' }));
    expect(container.querySelector('.row').className).not.toMatch(/row--decay/);
  });

  it('flashes once when a task transitions into a terminal state', () => {
    const { container, rerender } = render(
      <TaskRow task={task({ status: 'PROCESSING' })} expanded={false} onToggle={() => {}} />
    );
    expect(container.querySelector('.row').className).not.toMatch(/row--decay/);

    rerender(<TaskRow task={task({ status: 'COMPLETED' })} expanded={false} onToggle={() => {}} />);
    expect(container.querySelector('.row')).toHaveClass('row--decay-completed');
  });

  it('clears the flash after the decay window', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <TaskRow task={task({ status: 'PROCESSING' })} expanded={false} onToggle={() => {}} />
    );
    rerender(<TaskRow task={task({ status: 'COMPLETED' })} expanded={false} onToggle={() => {}} />);
    expect(container.querySelector('.row')).toHaveClass('row--decay-completed');

    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
  });

  it('does not flash for a non-terminal transition', () => {
    const { container, rerender } = render(
      <TaskRow task={task({ status: 'PENDING' })} expanded={false} onToggle={() => {}} />
    );
    rerender(<TaskRow task={task({ status: 'PROCESSING' })} expanded={false} onToggle={() => {}} />);
    expect(container.querySelector('.row').className).not.toMatch(/row--decay/);
  });
});
