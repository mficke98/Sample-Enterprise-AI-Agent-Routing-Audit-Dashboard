import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StreamPanel } from '../src/components/StreamPanel.jsx';
import { MAX_STREAM_ROWS } from '../src/lib/constants.js';
import { fallbackTask, task } from './fixtures.js';

const rows = (container) => container.querySelectorAll('.row');

describe('StreamPanel - the log region', () => {
  it('is a log that does NOT announce every append', () => {
    // aria-live="polite" here would flood a screen reader into uselessness;
    // the coalesced summary elsewhere does the announcing at a survivable rate.
    render(<StreamPanel tasks={[task()]} connection="live" />);
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'off');
    expect(log).toHaveAttribute('aria-label', 'Task events, newest first');
  });

  it('renders one row per task', () => {
    const { container } = render(
      <StreamPanel tasks={[task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })]} connection="live" />
    );
    expect(rows(container)).toHaveLength(3);
  });

  it('shows the visible row count', () => {
    const { container } = render(<StreamPanel tasks={[task({ id: 'a' }), task({ id: 'b' })]} connection="live" />);
    expect(container.querySelector('.panel__count')).toHaveTextContent('2');
  });

  it('marks the count with + at the cap, admitting older rows were dropped', () => {
    const many = Array.from({ length: MAX_STREAM_ROWS }, (_, i) => task({ id: `task-${i}` }));
    const { container } = render(<StreamPanel tasks={many} connection="live" />);
    expect(container.querySelector('.panel__count')).toHaveTextContent(`${MAX_STREAM_ROWS}+`);
  });
});

describe('StreamPanel - empty states', () => {
  it('distinguishes "connected but idle" from "not connected yet"', () => {
    const { rerender } = render(<StreamPanel tasks={[]} connection="live" />);
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();

    rerender(<StreamPanel tasks={[]} connection="connecting" />);
    expect(screen.getByText(/Waiting for the event stream/)).toBeInTheDocument();
  });

  it('tells the user how to populate the stream', () => {
    render(<StreamPanel tasks={[]} connection="live" />);
    expect(screen.getByText(/Load sample tasks/)).toBeInTheDocument();
  });
});

describe('StreamPanel - the fallback filter', () => {
  const mixed = [task({ id: 'a' }), fallbackTask({ id: 'b' }), task({ id: 'c' }), fallbackTask({ id: 'd' })];

  it('counts fallbacks across the whole list, not just what is filtered', () => {
    const { container } = render(<StreamPanel tasks={mixed} connection="live" />);
    const button = screen.getByRole('button', { name: /fallbacks/i });
    expect(within(button).getByText('2')).toBeInTheDocument();
    expect(rows(container)).toHaveLength(4);
  });

  it('filters to fallback tasks only when pressed', async () => {
    const user = userEvent.setup();
    const { container } = render(<StreamPanel tasks={mixed} connection="live" />);
    const button = screen.getByRole('button', { name: /fallbacks/i });

    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);

    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(rows(container)).toHaveLength(2);
    container.querySelectorAll('.row').forEach((row) => {
      expect(row).toHaveClass('row--fallback');
    });
  });

  it('toggles back off', async () => {
    const user = userEvent.setup();
    const { container } = render(<StreamPanel tasks={mixed} connection="live" />);
    const button = screen.getByRole('button', { name: /fallbacks/i });

    await user.click(button);
    await user.click(button);
    expect(rows(container)).toHaveLength(4);
  });

  it('explains an empty filtered view differently from an empty stream', async () => {
    const user = userEvent.setup();
    render(<StreamPanel tasks={[task({ id: 'a' })]} connection="live" />);
    await user.click(screen.getByRole('button', { name: /fallbacks/i }));

    expect(screen.getByText(/No task has been re-routed/)).toBeInTheDocument();
  });
});

describe('StreamPanel - pausing', () => {
  it('freezes the rendered list while events keep arriving', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <StreamPanel tasks={[task({ id: 'a' })]} connection="live" />
    );

    await user.click(screen.getByRole('button', { name: /pause stream/i }));
    rerender(<StreamPanel tasks={[task({ id: 'b' }), task({ id: 'a' })]} connection="live" />);

    // Still one row: the freeze is real, not cosmetic.
    expect(rows(container)).toHaveLength(1);
  });

  it('reports how many rows the pause is holding back', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<StreamPanel tasks={[task({ id: 'a' })]} connection="live" />);

    await user.click(screen.getByRole('button', { name: /pause stream/i }));
    rerender(
      <StreamPanel tasks={[task({ id: 'c' }), task({ id: 'b' }), task({ id: 'a' })]} connection="live" />
    );

    expect(screen.getByRole('status')).toHaveTextContent('2 new rows held');
  });

  it('uses the singular for a single held row', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<StreamPanel tasks={[task({ id: 'a' })]} connection="live" />);

    await user.click(screen.getByRole('button', { name: /pause stream/i }));
    rerender(<StreamPanel tasks={[task({ id: 'b' }), task({ id: 'a' })]} connection="live" />);

    expect(screen.getByRole('status')).toHaveTextContent('1 new row held');
  });

  it('says so when nothing has arrived during the pause', async () => {
    const user = userEvent.setup();
    render(<StreamPanel tasks={[task({ id: 'a' })]} connection="live" />);
    await user.click(screen.getByRole('button', { name: /pause stream/i }));
    expect(screen.getByRole('status')).toHaveTextContent('no new rows yet');
  });

  it('releases the held rows on resume', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <StreamPanel tasks={[task({ id: 'a' })]} connection="live" />
    );

    await user.click(screen.getByRole('button', { name: /pause stream/i }));
    rerender(<StreamPanel tasks={[task({ id: 'b' }), task({ id: 'a' })]} connection="live" />);
    expect(rows(container)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /resume stream/i }));
    expect(rows(container)).toHaveLength(2);
  });

  it('exposes the pause state as a toggle button', async () => {
    const user = userEvent.setup();
    render(<StreamPanel tasks={[task()]} connection="live" />);
    const button = screen.getByRole('button', { name: /pause stream/i });

    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);
    expect(screen.getByRole('button', { name: /resume stream/i })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('StreamPanel - row expansion', () => {
  it('expands one row at a time', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <StreamPanel tasks={[task({ id: 'task-0001' }), task({ id: 'task-0002' })]} connection="live" />
    );

    const [first, second] = container.querySelectorAll('.row__main');
    await user.click(first);
    expect(container.querySelectorAll('.row--expanded')).toHaveLength(1);

    await user.click(second);
    expect(container.querySelectorAll('.row--expanded')).toHaveLength(1);
    expect(second.closest('.row')).toHaveClass('row--expanded');
  });

  it('collapses a row when clicked again', async () => {
    const user = userEvent.setup();
    const { container } = render(<StreamPanel tasks={[task({ id: 'task-0001' })]} connection="live" />);

    const row = container.querySelector('.row__main');
    await user.click(row);
    expect(container.querySelectorAll('.row--expanded')).toHaveLength(1);

    await user.click(row);
    expect(container.querySelectorAll('.row--expanded')).toHaveLength(0);
  });
});
