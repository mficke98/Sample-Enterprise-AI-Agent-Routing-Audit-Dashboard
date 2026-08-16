import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TaskForm } from '../src/components/TaskForm.jsx';
import { ApiError } from '../src/lib/api.js';
import { task } from './fixtures.js';

// Mock the API module so the form is tested in isolation from transport.
vi.mock('../src/lib/api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createTask: vi.fn(),
    seedSampleTasks: vi.fn(),
  };
});

const { createTask, seedSampleTasks } = await import('../src/lib/api.js');

beforeEach(() => {
  vi.clearAllMocks();
});

const fill = async (user, { title = 'Quarterly review', payload = 'Check the ledger.' } = {}) => {
  await user.type(screen.getByLabelText('Title'), title);
  await user.type(screen.getByLabelText('Payload'), payload);
};

describe('TaskForm - submission', () => {
  it('submits the draft and reports where the task was routed', async () => {
    const user = userEvent.setup();
    createTask.mockResolvedValue(task({ title: 'Quarterly review' }));
    render(<TaskForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /submit task/i }));

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Quarterly review', payload: 'Check the ledger.' })
    );
    // The confirmation names the agent, which is the thing the user wants to know.
    expect(await screen.findByRole('status')).toHaveTextContent(/Tax Compliance Agent/);
  });

  it('clears the title and payload but KEEPS type and priority for rapid entry', async () => {
    const user = userEvent.setup();
    createTask.mockResolvedValue(task());
    render(<TaskForm />);

    await user.clear(screen.getByLabelText('Type'));
    await user.type(screen.getByLabelText('Type'), 'SECURITY');
    await user.selectOptions(screen.getByLabelText('Priority'), 'HIGH');
    await fill(user);
    await user.click(screen.getByRole('button', { name: /submit task/i }));

    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue(''));
    expect(screen.getByLabelText('Payload')).toHaveValue('');
    expect(screen.getByLabelText('Type')).toHaveValue('SECURITY');
    expect(screen.getByLabelText('Priority')).toHaveValue('HIGH');
  });

  it('accepts an unknown type, because the API routes those to GENERAL on purpose', async () => {
    const user = userEvent.setup();
    createTask.mockResolvedValue(task());
    render(<TaskForm />);

    // A <select> would make this untestable from the UI; the input is a
    // datalist-backed text field precisely so LEGAL can be typed.
    await user.clear(screen.getByLabelText('Type'));
    await user.type(screen.getByLabelText('Type'), 'LEGAL');
    await fill(user);
    await user.click(screen.getByRole('button', { name: /submit task/i }));

    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ type: 'LEGAL' }));
  });

  it('tells the user that unknown types route to GENERAL', () => {
    render(<TaskForm />);
    expect(screen.getByText(/Unknown types route to GENERAL/i)).toBeInTheDocument();
  });

  it('disables both buttons while a request is in flight', async () => {
    const user = userEvent.setup();
    let resolve;
    createTask.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<TaskForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /submit task/i }));

    expect(screen.getByRole('button', { name: /submit task/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /load sample tasks/i })).toBeDisabled();

    resolve(task());
    await waitFor(() => expect(screen.getByRole('button', { name: /submit task/i })).toBeEnabled());
  });
});

describe('TaskForm - per-field API errors', () => {
  const validationError = () =>
    new ApiError('Task validation failed.', {
      status: 400,
      code: 'VALIDATION_FAILED',
      details: [
        { field: 'title', message: 'title is required and must be a non-empty string.' },
        { field: 'payload', message: 'payload is required and must be a non-empty string.' },
      ],
    });

  it('binds each message to its own input rather than one opaque banner', async () => {
    const user = userEvent.setup();
    createTask.mockRejectedValue(validationError());
    render(<TaskForm />);

    await user.click(screen.getByRole('button', { name: /submit task/i }));

    const title = await screen.findByLabelText('Title');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAttribute('aria-describedby', 'title-error');
    expect(document.getElementById('title-error')).toHaveTextContent(/title is required/);

    const payload = screen.getByLabelText('Payload');
    expect(payload).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('payload-error')).toHaveTextContent(/payload is required/);
  });

  it('suppresses the generic banner when per-field messages already say it', async () => {
    const user = userEvent.setup();
    createTask.mockRejectedValue(validationError());
    render(<TaskForm />);

    await user.click(screen.getByRole('button', { name: /submit task/i }));
    await screen.findByText(/title is required/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('SHOWS a banner for an error no field can explain (a 503 or network drop)', async () => {
    const user = userEvent.setup();
    createTask.mockRejectedValue(
      new ApiError('Cannot reach the API. Is the server running on :4000?', {
        status: 0,
        code: 'NETWORK_ERROR',
      })
    );
    render(<TaskForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /submit task/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Cannot reach the API/);
  });

  it('clears a field error as soon as the user edits that field', async () => {
    const user = userEvent.setup();
    createTask.mockRejectedValue(validationError());
    render(<TaskForm />);

    await user.click(screen.getByRole('button', { name: /submit task/i }));
    await screen.findByText(/title is required/);

    await user.type(screen.getByLabelText('Title'), 'A');

    expect(screen.queryByText(/title is required/)).toBeNull();
    expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-invalid');
    // The untouched field keeps its error.
    expect(screen.getByLabelText('Payload')).toHaveAttribute('aria-invalid', 'true');
  });

  it('handles a non-ApiError rejection without leaking a stack trace', async () => {
    const user = userEvent.setup();
    createTask.mockRejectedValue(new Error('boom'));
    render(<TaskForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /submit task/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Unexpected error/);
    expect(screen.queryByText(/boom/)).toBeNull();
  });

  it('re-enables the form after a failure so the user can retry', async () => {
    const user = userEvent.setup();
    createTask.mockRejectedValue(validationError());
    render(<TaskForm />);

    await user.click(screen.getByRole('button', { name: /submit task/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /submit task/i })).toBeEnabled());
  });
});

describe('TaskForm - loading the sample tasks', () => {
  it('seeds and reports the count with correct pluralisation', async () => {
    const user = userEvent.setup();
    seedSampleTasks.mockResolvedValue({ count: 3, tasks: [] });
    render(<TaskForm />);

    await user.click(screen.getByRole('button', { name: /load sample tasks/i }));
    expect(seedSampleTasks).toHaveBeenCalledOnce();
    expect(await screen.findByRole('status')).toHaveTextContent('Loaded 3 sample tasks.');
  });

  it('uses the singular for one task', async () => {
    const user = userEvent.setup();
    seedSampleTasks.mockResolvedValue({ count: 1, tasks: [] });
    render(<TaskForm />);

    await user.click(screen.getByRole('button', { name: /load sample tasks/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('Loaded 1 sample task.');
  });

  it('surfaces a seeding failure as a banner', async () => {
    const user = userEvent.setup();
    seedSampleTasks.mockRejectedValue(
      new ApiError('Could not read sample_tasks.json.', { status: 500, code: 'SEED_FAILED' })
    );
    render(<TaskForm />);

    await user.click(screen.getByRole('button', { name: /load sample tasks/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not read sample_tasks/);
  });

  it('does not submit the form when the seed button is pressed', async () => {
    const user = userEvent.setup();
    seedSampleTasks.mockResolvedValue({ count: 3, tasks: [] });
    render(<TaskForm />);

    await user.click(screen.getByRole('button', { name: /load sample tasks/i }));
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe('TaskForm - labelling', () => {
  it('gives every control a real associated label', () => {
    render(<TaskForm />);
    for (const label of ['Title', 'Type', 'Priority', 'Payload']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('offers the known types as datalist suggestions without restricting input', () => {
    const { container } = render(<TaskForm />);
    const options = [...container.querySelectorAll('#task-type-options option')].map((o) => o.value);
    expect(options).toEqual(['TAX', 'AUDIT', 'SECURITY', 'GENERAL']);
    expect(screen.getByLabelText('Type').tagName).toBe('INPUT');
  });

  it('offers exactly the three valid priorities, since a typo there is a hard 400', () => {
    render(<TaskForm />);
    const values = [...screen.getByLabelText('Priority').options].map((o) => o.value);
    expect(values).toEqual(['HIGH', 'MEDIUM', 'LOW']);
  });
});
