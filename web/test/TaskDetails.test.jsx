import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TaskDetails } from '../src/components/TaskDetails.jsx';
import { ApiError } from '../src/lib/api.js';
import { fallbackTask, task } from './fixtures.js';

vi.mock('../src/lib/api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, executeTask: vi.fn() };
});

const { executeTask } = await import('../src/lib/api.js');

beforeEach(() => vi.clearAllMocks());

describe('TaskDetails - the facts strip', () => {
  it('shows id, timestamps and attempt count', () => {
    const { container } = render(<TaskDetails task={task()} />);
    const facts = container.querySelector('.detail__facts');
    expect(facts).toHaveTextContent('task-0001');
    expect(facts).toHaveTextContent('Attempts');
    expect(within(facts).getByText('1')).toBeInTheDocument();
  });

  it('dashes a completion time the task has not reached yet', () => {
    const { container } = render(
      <TaskDetails task={task({ status: 'PENDING', completed_at: null, attempts: [] })} />
    );
    expect(container.querySelector('.detail__facts')).toHaveTextContent('—');
  });

  it('renders the payload, and a dash when it is missing', () => {
    const { container } = render(<TaskDetails task={task()} />);
    expect(container.querySelector('.detail__payload')).toHaveTextContent(
      'Review Schedule C filings'
    );

    const { container: empty } = render(<TaskDetails task={task({ payload: '' })} />);
    expect(empty.querySelector('.detail__payload')).toHaveTextContent('—');
  });
});

describe('TaskDetails - the attempts table (the audit trail)', () => {
  it('renders one row per attempt, in order', () => {
    const { container } = render(<TaskDetails task={fallbackTask()} />);
    const rows = container.querySelectorAll('.attempts tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Audit Risk Scraper');
    expect(rows[1]).toHaveTextContent('General Fallback Agent');
  });

  it('shows the failure and the rescue side by side on a re-routed task', () => {
    const { container } = render(<TaskDetails task={fallbackTask()} />);
    const rows = container.querySelectorAll('.attempts tbody tr');
    expect(rows[0]).toHaveTextContent('ERROR');
    expect(rows[1]).toHaveTextContent('TIMEOUT');
  });

  it('numbers the attempts so order is unambiguous', () => {
    const { container } = render(<TaskDetails task={fallbackTask()} />);
    const cells = container.querySelectorAll('.attempts tbody tr td:first-child');
    expect([...cells].map((c) => c.textContent)).toEqual(['1', '2']);
  });

  it('bills every attempt, so the doubled cost of a fallback is visible', () => {
    const { container } = render(<TaskDetails task={fallbackTask()} />);
    const costs = [...container.querySelectorAll('.attempts tbody tr')].map(
      (row) => row.querySelectorAll('td')[5].textContent
    );
    expect(costs).toHaveLength(2);
    costs.forEach((c) => expect(c).toMatch(/\$\d\.\d{4}/));
  });

  it('renders each outcome with a glyph and a word', () => {
    const { container } = render(<TaskDetails task={fallbackTask()} />);
    const outcomes = container.querySelectorAll('.outcome');
    expect(outcomes[0]).toHaveTextContent('✕');
    expect(outcomes[0]).toHaveTextContent('ERROR');
    expect(outcomes[1]).toHaveTextContent('⧖');
    expect(outcomes[1]).toHaveTextContent('TIMEOUT');
  });

  it('surfaces the error text of a failed attempt', () => {
    const { container } = render(<TaskDetails task={fallbackTask()} />);
    expect(container.querySelector('.attempts__error')).toHaveTextContent(
      /unrecoverable inference error/
    );
  });

  it('dashes confidence on a failed attempt rather than printing null', () => {
    const { container } = render(<TaskDetails task={fallbackTask()} />);
    const firstRow = container.querySelector('.attempts tbody tr');
    expect(firstRow.querySelectorAll('td')[6]).toHaveTextContent('—');
  });

  it('says so when no attempt has been made', () => {
    render(<TaskDetails task={task({ status: 'PENDING', attempts: [], attempt_count: 0 })} />);
    expect(screen.getByText('No attempt has been made yet.')).toBeInTheDocument();
  });

  it('uses scoped column headers for screen readers', () => {
    const { container } = render(<TaskDetails task={task()} />);
    const headers = container.querySelectorAll('.attempts th');
    expect(headers.length).toBeGreaterThan(0);
    headers.forEach((th) => expect(th).toHaveAttribute('scope', 'col'));
  });

  it('lets a wide table scroll without breaking the page layout', () => {
    const { container } = render(<TaskDetails task={task()} />);
    expect(container.querySelector('.table-scroll')).toBeInTheDocument();
  });

  it('tolerates a malformed attempts field', () => {
    expect(() => render(<TaskDetails task={{ ...task(), attempts: null }} />)).not.toThrow();
  });
});

describe('TaskDetails - routing note and result', () => {
  it('shows the routing note only when the server sent one', () => {
    const { container: withNote } = render(<TaskDetails task={fallbackTask()} />);
    expect(withNote.querySelector('.detail__note')).toHaveTextContent(/Re-routed from Audit Risk/);

    const { container: without } = render(<TaskDetails task={task()} />);
    expect(without.querySelector('.detail__note')).toBeNull();
  });

  it('renders the result summary, classification and findings', () => {
    const { container } = render(<TaskDetails task={task()} />);
    expect(container.querySelector('.detail__summary')).toHaveTextContent(/Reviewed Q3 filings/);
    expect(container.querySelector('.tag--type')).toHaveTextContent('REVIEW_REQUIRED');
    expect(container.querySelectorAll('.findings li')).toHaveLength(2);
  });

  it('omits the result block entirely for a failed task', () => {
    const { container } = render(<TaskDetails task={fallbackTask()} />);
    expect(container.querySelector('.detail__summary')).toBeNull();
  });

  it('shows the terminal error for a failed task', () => {
    const { container } = render(<TaskDetails task={fallbackTask()} />);
    expect(container.querySelector('.detail__error')).toHaveTextContent(
      /exceeded its execution deadline/
    );
  });

  it('stringifies a non-string finding instead of rendering [object Object]', () => {
    const weird = task({
      result: { ...task().result, findings: [{ code: 'X1', detail: 'nested' }] },
    });
    const { container } = render(<TaskDetails task={weird} />);
    expect(container.querySelector('.findings li')).toHaveTextContent('"code"');
    expect(container.textContent).not.toMatch(/\[object Object\]/);
  });

  it('handles a result with no findings array', () => {
    const bare = task({ result: { summary: 'done', confidence: 0.9 } });
    expect(() => render(<TaskDetails task={bare} />)).not.toThrow();
  });
});

describe('TaskDetails - the Run now action', () => {
  it('appears only for a PENDING task', () => {
    const { container: pending } = render(
      <TaskDetails task={task({ status: 'PENDING', attempts: [] })} />
    );
    expect(within(pending).getByRole('button', { name: /run now/i })).toBeInTheDocument();

    const { container: done } = render(<TaskDetails task={task({ status: 'COMPLETED' })} />);
    expect(within(done).queryByRole('button', { name: /run now/i })).toBeNull();
  });

  it('calls the execute endpoint with the task id', async () => {
    const user = userEvent.setup();
    executeTask.mockResolvedValue(task());
    render(<TaskDetails task={task({ status: 'PENDING', attempts: [] })} />);

    await user.click(screen.getByRole('button', { name: /run now/i }));
    expect(executeTask).toHaveBeenCalledWith('task-0001');
  });

  it('translates a 409 into plain language rather than echoing the API', async () => {
    const user = userEvent.setup();
    executeTask.mockRejectedValue(
      new ApiError('Task task-0001 is PROCESSING; only PENDING tasks can be executed.', {
        status: 409,
        code: 'TASK_NOT_PENDING',
      })
    );
    render(<TaskDetails task={task({ status: 'PENDING', attempts: [] })} />);

    await user.click(screen.getByRole('button', { name: /run now/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Already picked up by the dispatcher/
    );
  });

  it('shows a non-409 API error verbatim', async () => {
    const user = userEvent.setup();
    executeTask.mockRejectedValue(
      new ApiError('No agent is assigned to this task.', { status: 500, code: 'NO_AGENT_ASSIGNED' })
    );
    render(<TaskDetails task={task({ status: 'PENDING', attempts: [] })} />);

    await user.click(screen.getByRole('button', { name: /run now/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('No agent is assigned to this task.');
  });

  it('handles a non-ApiError rejection without leaking internals', async () => {
    const user = userEvent.setup();
    executeTask.mockRejectedValue(new Error('kaboom'));
    render(<TaskDetails task={task({ status: 'PENDING', attempts: [] })} />);

    await user.click(screen.getByRole('button', { name: /run now/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not execute this task.');
    expect(screen.queryByText(/kaboom/)).toBeNull();
  });

  it('disables the button while the request is in flight, then re-enables', async () => {
    const user = userEvent.setup();
    let resolve;
    executeTask.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<TaskDetails task={task({ status: 'PENDING', attempts: [] })} />);

    const button = screen.getByRole('button', { name: /run now/i });
    await user.click(button);
    expect(button).toBeDisabled();

    resolve(task());
    await waitFor(() => expect(button).toBeEnabled());
  });
});
