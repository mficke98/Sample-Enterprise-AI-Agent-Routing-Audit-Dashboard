import { microsToUsd } from './executor.js';

/**
 * API shape for a task.
 *
 * Kept in one place so the REST responses and the SSE events can never drift
 * apart -- the dashboard merges both into the same client-side record, so a
 * field present in one and missing from the other produces flickering UI.
 *
 * Internal bookkeeping (the `_cost_micros` accumulator) is stripped here.
 */
export function toPublicTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    title: task.title,
    type: task.type,
    payload: task.payload,
    priority: task.priority,
    status: task.status,

    assigned_agent_id: task.assigned_agent_id,
    assigned_agent_name: task.assigned_agent_name,

    fallback_applied: task.fallback_applied,
    routing_note: task.routing_note,

    attempts: task.attempts.map((attempt) => ({
      agent_id: attempt.agent_id,
      agent_name: attempt.agent_name,
      agent_type: attempt.agent_type,
      outcome: attempt.outcome,
      latency_ms: attempt.latency_ms,
      tokens_used: attempt.tokens_used,
      cost_usd: microsToUsd(attempt.cost_micros ?? 0),
      confidence: attempt.confidence,
      error: attempt.error,
      at: attempt.at,
    })),
    attempt_count: task.attempts.length,

    result: task.result,
    error: task.error,

    latency_ms: task.latency_ms,
    total_tokens: task.total_tokens,
    total_cost_usd: task.total_cost_usd,

    created_at: task.created_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
  };
}
