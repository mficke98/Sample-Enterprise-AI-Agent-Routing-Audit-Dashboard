import { config } from '../config.js';

/**
 * Simulated agent execution.
 *
 * Pure-ish: it takes an agent + task and returns a structured outcome. It does
 * not touch the store, the registry, or the event bus -- which is what makes it
 * trivially testable and lets the orchestration layer decide what a failure
 * means (retry? fall back? give up?).
 */

export const OUTCOME = {
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  TIMEOUT: 'TIMEOUT',
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rough token estimate: ~4 chars per token, plus fixed prompt overhead, plus
 * jitter so repeated identical tasks don't produce suspiciously identical cost.
 */
export function estimateTokens(task, rng) {
  const chars = (task.payload?.length ?? 0) + (task.title?.length ?? 0);
  const base = Math.ceil(chars / 4) + 150; // 150 = system prompt overhead
  const jitter = 0.8 + rng.next() * 0.4; // +/-20%
  return Math.max(1, Math.round(base * jitter));
}

/**
 * Cost is accumulated in integer micro-dollars, never floats.
 *
 * At $0.008/1k tokens, repeatedly adding float dollars across hundreds of tasks
 * accumulates representation error, and this is billing data on an audit
 * dashboard. Integers add exactly; we divide once at the API boundary.
 */
export function costMicrosFor(tokens, costPer1kTokens) {
  return Math.round((tokens / 1000) * costPer1kTokens * 1_000_000);
}

export function microsToUsd(micros) {
  return Math.round(micros) / 1_000_000;
}

const OUTPUT_TEMPLATES = {
  TAX: (task) => ({
    summary: `Reviewed ${task.title} against current-year federal and state exemption schedules.`,
    findings: [
      'Schedule C line-item totals reconcile to submitted gross receipts.',
      '2 high-volume transactions exceed the materiality threshold and are flagged for manual review.',
      'No disallowed deductions detected in the sampled population.',
    ],
    classification: 'REVIEW_REQUIRED',
  }),
  AUDIT: (task) => ({
    summary: `Cross-referenced ledger entries for ${task.title}.`,
    findings: [
      '3 journal entries lack a matching bank reconciliation record.',
      'Aggregate unreconciled variance: $14,208.55.',
      'Control weakness indicated in the month-end close approval chain.',
    ],
    classification: 'DISCREPANCY_FOUND',
  }),
  SECURITY: (task) => ({
    summary: `Scanned document stream for unmasked sensitive identifiers.`,
    findings: [
      '2 unmasked SSN patterns detected (positions 1284, 4471).',
      '1 EIN present in plaintext within an appendix table.',
      'Recommend redaction before external distribution.',
    ],
    classification: 'PII_DETECTED',
  }),
  GENERAL: (task) => ({
    summary: `General-purpose analysis completed for ${task.title}.`,
    findings: [
      'Document parsed and classified without a specialist model.',
      'Confidence is lower than a domain-specific agent would produce.',
      'Escalation to a specialist agent is recommended if this result is material.',
    ],
    classification: 'GENERAL_REVIEW',
  }),
};

function buildOutput(agent, task) {
  const template = OUTPUT_TEMPLATES[agent.type] ?? OUTPUT_TEMPLATES.GENERAL;
  return template(task);
}

const FAILURE_MESSAGES = {
  [OUTCOME.TIMEOUT]: (agent) => `${agent.name} exceeded its execution deadline and was terminated.`,
  [OUTCOME.ERROR]: (agent) => `${agent.name} returned an unrecoverable inference error.`,
};

/**
 * Run one simulated attempt.
 *
 * @param {object} agent - registry agent record
 * @param {object} task  - task record
 * @param {object} deps  - { rng, sleep } (sleep injectable so tests run instantly)
 * @returns {Promise<object>} attempt result
 */
export async function simulateExecution(agent, task, { rng, sleep = defaultSleep } = {}) {
  if (!agent) throw new Error('simulateExecution requires an agent');
  if (!rng) throw new Error('simulateExecution requires an rng');

  const startedAt = Date.now();
  const plannedDelayMs = rng.nextInt(config.minDelayMs, config.maxDelayMs);
  await sleep(plannedDelayMs);

  // Measure real elapsed time rather than trusting the planned delay -- with an
  // injected instant sleep these differ, and the metric should reflect reality.
  const latencyMs = Math.max(0, Date.now() - startedAt);

  const tokensUsed = estimateTokens(task, rng);
  const costMicros = costMicrosFor(tokensUsed, agent.cost_per_1k_tokens);

  const failed = rng.chance(config.failureRate);

  if (failed) {
    const outcome = rng.chance(config.timeoutShare) ? OUTCOME.TIMEOUT : OUTCOME.ERROR;
    return {
      outcome,
      agent_id: agent.id,
      agent_name: agent.name,
      agent_type: agent.type,
      latency_ms: latencyMs,
      planned_delay_ms: plannedDelayMs,
      // A failed attempt still burns tokens -- the model was invoked, the
      // deadline was hit partway through. Billing an audit trail as if failures
      // were free would understate true cost, which is the metric that matters.
      tokens_used: tokensUsed,
      cost_micros: costMicros,
      confidence: null,
      output: null,
      error: FAILURE_MESSAGES[outcome](agent),
      at: new Date().toISOString(),
    };
  }

  // The generalist is deliberately less confident than a specialist. This shows
  // up on the dashboard as a visible quality cost of having fallen back.
  const confidence = agent.type === 'GENERAL'
    ? Number((0.62 + rng.next() * 0.23).toFixed(3))
    : Number((0.82 + rng.next() * 0.17).toFixed(3));

  return {
    outcome: OUTCOME.SUCCESS,
    agent_id: agent.id,
    agent_name: agent.name,
    agent_type: agent.type,
    latency_ms: latencyMs,
    planned_delay_ms: plannedDelayMs,
    tokens_used: tokensUsed,
    cost_micros: costMicros,
    confidence,
    output: buildOutput(agent, task),
    error: null,
    at: new Date().toISOString(),
  };
}
