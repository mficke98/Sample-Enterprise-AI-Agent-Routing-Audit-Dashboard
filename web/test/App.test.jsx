import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';

import App from '../src/App.jsx';
import { MockEventSource, installMockEventSource } from './mockEventSource.js';
import { AGENTS, fallbackTask, metrics, snapshot, task } from './fixtures.js';

let restore;

beforeEach(() => {
  restore = installMockEventSource();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => restore?.());

/** Mount the dashboard and deliver the hydration frame. */
function mount(frame = snapshot()) {
  const view = render(<App />);
  act(() => {
    MockEventSource.latest.open();
    MockEventSource.latest.emit('snapshot', frame);
  });
  return view;
}

describe('App - the four regions', () => {
  it('renders header, metrics, agent board, form and stream together', () => {
    mount();
    expect(screen.getByText('Control Room')).toBeInTheDocument();
    expect(screen.getByLabelText('System metrics')).toBeInTheDocument();
    expect(screen.getByLabelText('Agent roster')).toBeInTheDocument();
    expect(screen.getByLabelText('Task stream')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });

  it('opens exactly one event stream for the whole dashboard', () => {
    mount();
    // Four regions all read from one connection. Several would multiply
    // server-side listeners and let regions disagree with each other.
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('renders sensibly before any snapshot arrives', () => {
    render(<App />);
    expect(screen.getByText(/Waiting for the agent roster/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the event stream/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });
});

describe('App - live updates flow end to end', () => {
  it('hydrates every region from the snapshot frame', () => {
    const { container } = mount();
    expect(container.querySelectorAll('.card.agent')).toHaveLength(4);
    expect(container.querySelectorAll('.row')).toHaveLength(1);
    expect(screen.getByLabelText('System metrics')).toHaveTextContent('168');
  });

  it('adds a task row when a task.created frame arrives', () => {
    const { container } = mount(snapshot({ tasks: [] }));
    expect(container.querySelectorAll('.row')).toHaveLength(0);

    act(() => MockEventSource.latest.emit('task.created', task({ id: 'task-0100' })));
    expect(container.querySelectorAll('.row')).toHaveLength(1);
  });

  it('shows the fallback treatment when a task.fallback frame arrives', () => {
    const { container } = mount(snapshot({ tasks: [] }));
    act(() => MockEventSource.latest.emit('task.fallback', fallbackTask({ id: 'task-0200' })));

    const row = container.querySelector('.row');
    expect(row).toHaveClass('row--fallback');
    expect(within(row).getByText(/FALLBACK/)).toBeInTheDocument();
  });

  it('updates an agent card from an agent.status frame', () => {
    const { container } = mount();
    act(() =>
      MockEventSource.latest.emit('agent.status', {
        ...AGENTS[0],
        status: 'PROCESSING',
        active: 3,
        capacity_label: '3/3',
      })
    );

    const card = container.querySelector('.agent');
    expect(within(card).getByText('PROCESSING')).toBeInTheDocument();
    expect(within(card).getByText('AT CAPACITY')).toBeInTheDocument();
  });

  it('updates the metric cards from a metrics.updated frame', () => {
    mount();
    act(() =>
      MockEventSource.latest.emit(
        'metrics.updated',
        metrics({ system_health: { status: 'DEGRADED', reason: 'Success rate 74.0%.', agents_in_error: 0 } })
      )
    );
    expect(screen.getByLabelText('System metrics')).toHaveTextContent('DEGRADED');
  });
});

describe('App - connection honesty', () => {
  it('reports Live once connected', () => {
    mount();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('admits when the stream has dropped rather than showing stale data as live', () => {
    mount();
    act(() => MockEventSource.latest.fail());
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
    // The last known data stays on screen -- clearly labelled as not live.
    expect(screen.getByLabelText('System metrics')).toHaveTextContent('168');
  });
});

describe('App - live regions', () => {
  it('has a polite status region and an assertive alert region', () => {
    const { container } = mount();
    const polite = container.querySelector('[role="status"][aria-live="polite"]');
    const assertive = container.querySelector('[role="alert"][aria-live="assertive"]');
    expect(polite).toBeInTheDocument();
    expect(assertive).toBeInTheDocument();
  });

  it('keeps the assertive region silent while healthy', () => {
    const { container } = mount();
    expect(container.querySelector('[role="alert"]').textContent).toBe('');
  });

  it('fires the assertive alert only when health enters CRITICAL', () => {
    const { container } = mount();
    const alert = () => container.querySelector('[role="alert"]').textContent;

    act(() =>
      MockEventSource.latest.emit(
        'metrics.updated',
        metrics({ system_health: { status: 'CRITICAL', reason: 'Success rate 12.0%.', agents_in_error: 2 } })
      )
    );
    expect(alert()).toMatch(/System health critical/);
    expect(alert()).toMatch(/12.0%/);
  });

  it('clears the alert when health recovers', () => {
    const { container } = mount();
    const alert = () => container.querySelector('[role="alert"]').textContent;

    act(() =>
      MockEventSource.latest.emit(
        'metrics.updated',
        metrics({ system_health: { status: 'CRITICAL', reason: 'bad', agents_in_error: 2 } })
      )
    );
    expect(alert()).not.toBe('');

    act(() =>
      MockEventSource.latest.emit(
        'metrics.updated',
        metrics({ system_health: { status: 'HEALTHY', reason: 'recovered', agents_in_error: 0 } })
      )
    );
    expect(alert()).toBe('');
  });

  it('does not re-fire the alert on every repeated CRITICAL frame', () => {
    const { container } = mount();
    const critical = () =>
      metrics({ system_health: { status: 'CRITICAL', reason: 'still bad', agents_in_error: 2 } });

    act(() => MockEventSource.latest.emit('metrics.updated', critical()));
    const first = container.querySelector('[role="alert"]').textContent;

    // An assertive region interrupts the user. Repeating an unchanged state
    // would interrupt them every few hundred milliseconds.
    act(() => MockEventSource.latest.emit('metrics.updated', critical()));
    expect(container.querySelector('[role="alert"]').textContent).toBe(first);
  });
});

describe('App - theme switching', () => {
  it('applies the dark theme to the document by default', () => {
    mount();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('offers a toggle labelled with the result of pressing it', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });
});
