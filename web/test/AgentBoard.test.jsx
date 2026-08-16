import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AgentBoard } from '../src/components/AgentBoard.jsx';
import { AGENTS, agent } from './fixtures.js';

describe('AgentBoard - the roster', () => {
  it('renders one card per agent', () => {
    const { container } = render(<AgentBoard agents={AGENTS} />);
    expect(container.querySelectorAll('.card.agent')).toHaveLength(4);
  });

  it('shows a waiting state rather than an empty region before hydration', () => {
    render(<AgentBoard agents={[]} />);
    expect(screen.getByText(/Waiting for the agent roster/)).toBeInTheDocument();
  });

  it('labels the region for assistive tech', () => {
    render(<AgentBoard agents={AGENTS} />);
    expect(screen.getByLabelText('Agent roster')).toBeInTheDocument();
  });

  it('names every agent and its type', () => {
    render(<AgentBoard agents={AGENTS} />);
    expect(screen.getByText('Tax Compliance Agent')).toBeInTheDocument();
    expect(screen.getByText('Audit Risk Scraper')).toBeInTheDocument();
    expect(screen.getByText('Security & PII Scanner')).toBeInTheDocument();
    expect(screen.getByText('General Fallback Agent')).toBeInTheDocument();
  });
});

describe('AgentBoard - status', () => {
  it.each([
    ['IDLE', '○'],
    ['PROCESSING', '◐'],
    ['ERROR', '✕'],
  ])('renders %s with both a glyph and the word', (status, glyph) => {
    const { container } = render(<AgentBoard agents={[agent({ status })]} />);
    expect(container.querySelector('.pill__glyph')).toHaveTextContent(glyph);
    expect(container.querySelector('.pill__label')).toHaveTextContent(status);
  });

  it('applies a status modifier class to the card', () => {
    const { container } = render(<AgentBoard agents={[agent({ status: 'ERROR' })]} />);
    expect(container.querySelector('.agent')).toHaveClass('agent--error');
  });

  it('pulses ONLY while processing', () => {
    // The pulse is the one looping animation in the app and it exists on at
    // most four elements. It must not run on an idle agent.
    const { container: busy } = render(<AgentBoard agents={[agent({ status: 'PROCESSING' })]} />);
    expect(busy.querySelector('.agent__pulse')).toHaveClass('agent__pulse--on');

    for (const status of ['IDLE', 'ERROR']) {
      const { container } = render(<AgentBoard agents={[agent({ status })]} />);
      expect(container.querySelector('.agent__pulse')).not.toHaveClass('agent__pulse--on');
    }
  });

  it('hides the pulse from assistive tech, since the pill already says it', () => {
    const { container } = render(<AgentBoard agents={[agent({ status: 'PROCESSING' })]} />);
    expect(container.querySelector('.agent__pulse')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('AgentBoard - capacity and cost', () => {
  it('renders the capacity meter with the agent limits', () => {
    render(<AgentBoard agents={[agent({ active: 2, max_concurrent: 3 })]} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '2 of 3 slots in use');
  });

  it('flags saturation on the card', () => {
    render(<AgentBoard agents={[agent({ active: 3, max_concurrent: 3 })]} />);
    expect(screen.getByText('AT CAPACITY')).toBeInTheDocument();
  });

  it('shows each agent its own price, since cost differs per agent', () => {
    const { container } = render(<AgentBoard agents={AGENTS} />);
    const rates = [...container.querySelectorAll('.agent__rate')].map((el) => el.textContent);
    expect(rates).toEqual([
      '$0.015 / 1k',
      '$0.020 / 1k',
      '$0.008 / 1k',
      '$0.005 / 1k',
    ]);
  });
});

describe('AgentBoard - the fallback target', () => {
  it('marks the GENERAL agent so its role is visible before anything fails', () => {
    const { container } = render(<AgentBoard agents={AGENTS} />);
    const tags = [...container.querySelectorAll('.tag--fallback')];
    expect(tags).toHaveLength(1);
    expect(tags[0]).toHaveTextContent('FALLBACK TARGET');
    expect(tags[0]).toHaveTextContent('↩');
  });

  it('explains the role on hover', () => {
    render(<AgentBoard agents={AGENTS} />);
    expect(
      screen.getByTitle('Tasks that fail elsewhere are re-routed here')
    ).toBeInTheDocument();
  });

  it('does not mark specialists as fallback targets', () => {
    const { container } = render(<AgentBoard agents={[agent()]} />);
    expect(container.querySelector('.tag--fallback')).toBeNull();
  });
});

describe('AgentBoard - tallies', () => {
  it('shows completed and failed counts with screen-reader labels', () => {
    const { container } = render(<AgentBoard agents={[agent({ completed: 42, failed: 3 })]} />);
    const tally = container.querySelector('.agent__tally');
    expect(tally).toHaveTextContent('42');
    expect(tally).toHaveTextContent('3');
    expect(tally).toHaveTextContent('completed');
    expect(tally).toHaveTextContent('failed');
  });

  it('tones the failure count only when there are failures', () => {
    const { container: clean } = render(<AgentBoard agents={[agent({ failed: 0 })]} />);
    expect(clean.querySelector('.agent__tally .tone-error')).toBeNull();

    const { container: failing } = render(<AgentBoard agents={[agent({ failed: 2 })]} />);
    expect(failing.querySelector('.agent__tally .tone-error')).toBeTruthy();
  });

  it('renders zeros rather than dashes for a fresh agent', () => {
    const { container } = render(<AgentBoard agents={[agent()]} />);
    const tally = container.querySelector('.agent__tally');
    expect(tally.textContent).not.toMatch(/—/);
    expect(tally).toHaveTextContent('0');
  });

  it('never emits NaN for a partial agent frame', () => {
    const { container } = render(
      <AgentBoard agents={[{ id: 'x', name: 'Partial', type: 'TAX', status: 'IDLE' }]} />
    );
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });
});
