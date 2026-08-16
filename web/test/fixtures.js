/**
 * Fixtures mirroring the real API payloads.
 *
 * These are copied from actual server responses rather than invented, so a
 * change to the wire format breaks these tests instead of silently passing
 * against a shape the server no longer sends.
 */

export const agent = (overrides = {}) => ({
  id: 'agent-tax-01',
  name: 'Tax Compliance Agent',
  type: 'TAX',
  status: 'IDLE',
  active: 0,
  max_concurrent: 3,
  capacity_label: '0/3',
  utilization: 0,
  cost_per_1k_tokens: 0.015,
  completed: 0,
  failed: 0,
  is_fallback_agent: false,
  ...overrides,
});

export const AGENTS = [
  agent(),
  agent({ id: 'agent-audit-02', name: 'Audit Risk Scraper', type: 'AUDIT', max_concurrent: 2, cost_per_1k_tokens: 0.02 }),
  agent({ id: 'agent-sec-03', name: 'Security & PII Scanner', type: 'SECURITY', max_concurrent: 5, cost_per_1k_tokens: 0.008 }),
  agent({
    id: 'agent-gen-00',
    name: 'General Fallback Agent',
    type: 'GENERAL',
    max_concurrent: 10,
    cost_per_1k_tokens: 0.005,
    is_fallback_agent: true,
  }),
];

export const attempt = (overrides = {}) => ({
  agent_id: 'agent-tax-01',
  agent_name: 'Tax Compliance Agent',
  agent_type: 'TAX',
  outcome: 'SUCCESS',
  latency_ms: 1284,
  tokens_used: 155,
  cost_usd: 0.002325,
  confidence: 0.91,
  error: null,
  at: '2026-08-15T14:03:27.000Z',
  ...overrides,
});

export const task = (overrides = {}) => ({
  id: 'task-0001',
  title: 'Q3 Corporate Tax Exemption Verification',
  type: 'TAX',
  payload: 'Review Schedule C filings for high-volume transactions.',
  priority: 'HIGH',
  status: 'COMPLETED',
  assigned_agent_id: 'agent-tax-01',
  assigned_agent_name: 'Tax Compliance Agent',
  fallback_applied: false,
  routing_note: null,
  attempts: [attempt()],
  attempt_count: 1,
  result: {
    summary: 'Reviewed Q3 filings against current-year exemption schedules.',
    findings: ['Schedule C totals reconcile.', '2 transactions flagged for manual review.'],
    classification: 'REVIEW_REQUIRED',
    confidence: 0.91,
    agent_id: 'agent-tax-01',
    agent_name: 'Tax Compliance Agent',
    tokens_used: 155,
    cost_usd: 0.002325,
    latency_ms: 1284,
  },
  error: null,
  latency_ms: 1284,
  total_tokens: 155,
  total_cost_usd: 0.002325,
  created_at: '2026-08-15T14:03:27.000Z',
  started_at: '2026-08-15T14:03:26.000Z',
  completed_at: '2026-08-15T14:03:27.000Z',
  ...overrides,
});

/** A task that failed on its specialist and was re-routed to GENERAL. */
export const fallbackTask = (overrides = {}) =>
  task({
    id: 'task-0002',
    title: 'Financial Ledger Discrepancy Analysis',
    type: 'AUDIT',
    status: 'FAILED',
    assigned_agent_id: 'agent-gen-00',
    assigned_agent_name: 'General Fallback Agent',
    fallback_applied: true,
    routing_note: 'Re-routed from Audit Risk Scraper after failure.',
    attempts: [
      attempt({
        agent_id: 'agent-audit-02',
        agent_name: 'Audit Risk Scraper',
        agent_type: 'AUDIT',
        outcome: 'ERROR',
        confidence: null,
        error: 'Audit Risk Scraper returned an unrecoverable inference error.',
      }),
      attempt({
        agent_id: 'agent-gen-00',
        agent_name: 'General Fallback Agent',
        agent_type: 'GENERAL',
        outcome: 'TIMEOUT',
        confidence: null,
        error: 'General Fallback Agent exceeded its execution deadline.',
      }),
    ],
    attempt_count: 2,
    result: null,
    error: 'General Fallback Agent exceeded its execution deadline.',
    latency_ms: 2416,
    total_cost_usd: 0.00311,
    ...overrides,
  });

export const metrics = (overrides = {}) => ({
  generated_at: '2026-08-15T14:05:00.000Z',
  totals: { tasks: 168, pending: 2, processing: 1, completed: 160, failed: 5, terminal: 165 },
  success_rate: 0.9697,
  latency: { avg_ms: 1284, min_ms: 902, max_ms: 3102, p95_ms: 2810, samples: 165 },
  fallback: { count: 7, rate: 0.0417, label: '7 of 168' },
  cost: { total_tokens: 25840, total_usd: 0.44712 },
  per_agent_type: [],
  queue: { depth: 2, high_priority_waiting: 1, in_flight: 1 },
  system_health: { status: 'HEALTHY', reason: 'Success rate 97.0% across 165 completed tasks.', agents_in_error: 0 },
  ...overrides,
});

/** The zero state: a freshly started server with nothing processed. */
export const emptyMetrics = () =>
  metrics({
    totals: { tasks: 0, pending: 0, processing: 0, completed: 0, failed: 0, terminal: 0 },
    success_rate: 0,
    latency: { avg_ms: 0, min_ms: 0, max_ms: 0, p95_ms: 0, samples: 0 },
    fallback: { count: 0, rate: 0, label: '0 of 0' },
    cost: { total_tokens: 0, total_usd: 0 },
    queue: { depth: 0, high_priority_waiting: 0, in_flight: 0 },
    system_health: { status: 'HEALTHY', reason: 'No tasks processed yet.', agents_in_error: 0 },
  });

export const snapshot = (overrides = {}) => ({
  agents: AGENTS,
  tasks: [task()],
  metrics: metrics(),
  config: { failure_rate: 0.1, min_delay_ms: 1000, max_delay_ms: 3000 },
  ...overrides,
});
