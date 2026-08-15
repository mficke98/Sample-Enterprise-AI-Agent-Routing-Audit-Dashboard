/**
 * Thin API client.
 *
 * Relative URLs only -- Vite proxies `/api` in dev, and a production build
 * served from the API host needs no configuration at all.
 */

/**
 * An API error that preserves the server's structured envelope:
 *   { error: { code, message, details: [{ field, message }] } }
 *
 * The `details` array is the whole point: the task form binds it to individual
 * inputs rather than dumping one opaque banner, so the user is told which field
 * is wrong instead of that something is wrong.
 */
export class ApiError extends Error {
  constructor(message, { status, code, details }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? 'UNKNOWN';
    this.details = Array.isArray(details) ? details : [];
  }

  /** `{ title: 'title is required...' }` for direct lookup while rendering. */
  get fieldErrors() {
    const map = {};
    for (const detail of this.details) {
      if (detail && detail.field && !map[detail.field]) map[detail.field] = detail.message;
    }
    return map;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...options,
    });
  } catch (cause) {
    // Network-level failure: the API is down or unreachable. Surface it as the
    // same shape as an API error so callers have one code path.
    throw new ApiError('Cannot reach the API. Is the server running on :4000?', {
      status: 0,
      code: 'NETWORK_ERROR',
    });
  }

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const envelope = body && typeof body === 'object' ? body.error : null;
    throw new ApiError(envelope?.message || `Request failed (HTTP ${response.status}).`, {
      status: response.status,
      code: envelope?.code,
      details: envelope?.details,
    });
  }

  return body;
}

/**
 * Only the three WRITE endpoints are wrapped here.
 *
 * `GET /api/agents`, `GET /api/tasks` and `GET /api/metrics` are deliberately
 * unused by the dashboard: the SSE `snapshot` frame already carries agents,
 * tasks, metrics and config, and it is re-sent on every reconnect. Fetching
 * them separately would add a second source of truth that can disagree with
 * the stream, which is exactly the flicker this design is trying to avoid.
 */

export const createTask = (input) =>
  request('/api/tasks', { method: 'POST', body: JSON.stringify(input) });

export const seedSampleTasks = () => request('/api/tasks/seed/sample', { method: 'POST' });

export const executeTask = (id) =>
  request(`/api/tasks/${encodeURIComponent(id)}/execute`, { method: 'POST' });
