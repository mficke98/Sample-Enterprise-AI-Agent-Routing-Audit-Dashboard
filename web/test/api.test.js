import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ApiError, createTask, executeTask, seedSampleTasks } from '../src/lib/api.js';
import { task } from './fixtures.js';

/** Build a fetch stand-in returning one canned response. */
function mockFetch({ ok = true, status = 200, body = null, reject = false } = {}) {
  const fn = vi.fn(async () => {
    if (reject) throw new TypeError('Failed to fetch');
    return {
      ok,
      status,
      text: async () => (body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
    };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('createTask', () => {
  it('POSTs JSON to /api/tasks and returns the parsed body', async () => {
    const fetchMock = mockFetch({ body: task() });
    const result = await createTask({ title: 'T', type: 'TAX', payload: 'p', priority: 'HIGH' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tasks');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toMatchObject({ title: 'T', type: 'TAX' });
    expect(result.id).toBe('task-0001');
  });

  it('uses a relative URL so no host configuration is needed', async () => {
    const fetchMock = mockFetch({ body: task() });
    await createTask({});
    expect(fetchMock.mock.calls[0][0].startsWith('/')).toBe(true);
  });
});

describe('seedSampleTasks and executeTask', () => {
  it('seeds via the dedicated endpoint', async () => {
    const fetchMock = mockFetch({ body: { count: 3, tasks: [] } });
    const result = await seedSampleTasks();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tasks/seed/sample');
    expect(result.count).toBe(3);
  });

  it('URL-encodes the task id so a malformed id cannot alter the path', async () => {
    const fetchMock = mockFetch({ body: task() });
    await executeTask('task/../../admin');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tasks/task%2F..%2F..%2Fadmin/execute');
  });
});

describe('ApiError - preserving the server envelope', () => {
  it('surfaces a 400 with its per-field details', async () => {
    mockFetch({
      ok: false,
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Task validation failed.',
          details: [
            { field: 'title', message: 'title is required and must be a non-empty string.' },
            { field: 'payload', message: 'payload is required and must be a non-empty string.' },
          ],
        },
      },
    });

    const error = await createTask({}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toHaveLength(2);
  });

  it('maps details into a field -> message lookup for the form', () => {
    const error = new ApiError('nope', {
      status: 400,
      code: 'VALIDATION_FAILED',
      details: [
        { field: 'title', message: 'title required' },
        { field: 'priority', message: 'bad priority' },
      ],
    });
    expect(error.fieldErrors).toEqual({ title: 'title required', priority: 'bad priority' });
  });

  it('keeps the FIRST message when a field appears twice', () => {
    const error = new ApiError('nope', {
      status: 400,
      details: [
        { field: 'title', message: 'first' },
        { field: 'title', message: 'second' },
      ],
    });
    expect(error.fieldErrors.title).toBe('first');
  });

  it('ignores malformed detail entries instead of throwing', () => {
    const error = new ApiError('nope', {
      status: 400,
      details: [null, {}, { message: 'no field' }, { field: 'title', message: 'ok' }],
    });
    expect(error.fieldErrors).toEqual({ title: 'ok' });
  });

  it('defaults details to an empty array when the server omits them', () => {
    const error = new ApiError('nope', { status: 503 });
    expect(error.details).toEqual([]);
    expect(error.fieldErrors).toEqual({});
    expect(error.code).toBe('UNKNOWN');
  });

  it('surfaces a 409 conflict message verbatim', async () => {
    mockFetch({
      ok: false,
      status: 409,
      body: { error: { code: 'TASK_NOT_PENDING', message: 'Task task-0001 is COMPLETED; only PENDING tasks can be executed.' } },
    });
    const error = await executeTask('task-0001').catch((e) => e);
    expect(error.status).toBe(409);
    expect(error.code).toBe('TASK_NOT_PENDING');
    expect(error.message).toMatch(/only PENDING tasks/);
  });
});

describe('transport and parsing failures', () => {
  it('turns a network failure into an ApiError with actionable guidance', async () => {
    mockFetch({ reject: true });
    const error = await createTask({}).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
    // The message should tell the user what to actually do about it.
    expect(error.message).toMatch(/server running/i);
  });

  it('falls back to a generic message when an error body is not JSON', async () => {
    mockFetch({ ok: false, status: 500, body: '<html>Internal Server Error</html>' });
    const error = await createTask({}).catch((e) => e);
    expect(error.message).toMatch(/HTTP 500/);
    expect(error.details).toEqual([]);
  });

  it('returns null for a successful empty body rather than throwing', async () => {
    mockFetch({ ok: true, status: 204, body: null });
    await expect(createTask({})).resolves.toBeNull();
  });

  it('does not throw on a success body that is not JSON', async () => {
    mockFetch({ ok: true, status: 200, body: 'plain text' });
    await expect(createTask({})).resolves.toBeNull();
  });
});
