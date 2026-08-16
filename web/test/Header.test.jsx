import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConnectionIndicator } from '../src/components/ConnectionIndicator.jsx';
import { Header } from '../src/components/Header.jsx';

describe('ConnectionIndicator', () => {
  it.each([
    ['live', 'Live', '●', 'success'],
    ['connecting', 'Connecting', '◌', 'idle'],
    ['reconnecting', 'Reconnecting', '◍', 'warn'],
  ])('renders %s with a glyph, a word and a tone', (state, label, glyph, tone) => {
    const { container } = render(<ConnectionIndicator state={state} />);
    expect(container.querySelector('.conn')).toHaveClass(`tone-${tone}`);
    expect(container.querySelector('.conn__dot')).toHaveTextContent(glyph);
    expect(container.querySelector('.conn__label')).toHaveTextContent(label);
  });

  it('falls back to connecting for an unknown state rather than rendering blank', () => {
    const { container } = render(<ConnectionIndicator state="banana" />);
    expect(container.querySelector('.conn__label')).toHaveTextContent('Connecting');
  });

  it('handles a missing state prop', () => {
    const { container } = render(<ConnectionIndicator />);
    expect(container.querySelector('.conn__label')).toHaveTextContent('Connecting');
  });

  it('hides the decorative dot but announces the state', () => {
    render(<ConnectionIndicator state="live" />);
    expect(screen.getByText('Event stream Live')).toBeInTheDocument();
    expect(screen.getByTitle('Event stream: Live')).toBeInTheDocument();
  });
});

describe('Header', () => {
  const renderHeader = (props = {}) =>
    render(<Header connection="live" theme="dark" onToggleTheme={() => {}} {...props} />);

  it('renders the product identity as the page heading', () => {
    renderHeader();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Control Room');
    expect(screen.getByText('Agent routing & audit')).toBeInTheDocument();
  });

  it('shows the live connection state', () => {
    renderHeader({ connection: 'reconnecting' });
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
  });

  it('labels the theme button with the RESULT of pressing it', () => {
    // "Switch to light theme" tells a screen reader user what will happen;
    // aria-pressed would describe a toggle state with no obvious "on" reading.
    renderHeader({ theme: 'dark' });
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();

    renderHeader({ theme: 'light' });
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
  });

  it('shows the opposite theme as the visible button text', () => {
    const { container } = renderHeader({ theme: 'dark' });
    expect(container.querySelector('.btn__text')).toHaveTextContent('Light');
  });

  it('invokes the toggle handler on click', async () => {
    const onToggleTheme = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onToggleTheme });

    await user.click(screen.getByRole('button', { name: /switch to/i }));
    expect(onToggleTheme).toHaveBeenCalledOnce();
  });

  it('hides the decorative mark and icon from assistive tech', () => {
    const { container } = renderHeader();
    expect(container.querySelector('.topbar__mark')).toHaveAttribute('aria-hidden', 'true');
  });
});
