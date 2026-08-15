import { TASK_STATUS } from '../config.js';
import { microsToUsd } from './executor.js';

/**
 * Audit & metrics aggregation.
 *
 * Every ratio here is guarded against a zero denominator. An empty system must
 * report 0 and HEALTHY, never NaN -- a dashboard showing "NaN%" on first load
 * is the single most common bug in this kind of endpoint.
 */

const HEALTH = { HEALTHY: 'HEALTHY', DEGRADED: 'DEGRADED', CRITICAL: 'CRITICAL' };

function safeDivide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)];
}

export function computeMetrics({ registry, taskStore, dispatcher } = {}) {
  const tasks = taskStore.all();
  const counts = taskStore.countsByStatus();

  const completed = counts[TASK_STATUS.COMPLETED];
  const failed = counts[TASK_STATUS.FAILED];
  const terminal = completed + failed;

  // --- latency across terminal tasks (wall clock, including any retry) ---
  const latencies = tasks
    .filter((t) => t.latency_ms !== null && t.latency_ms !== undefined)
    .map((t) => t.latency_ms)
    .sort((a, b) => a - b);

  const totalLatency = latencies.reduce((sum, ms) => sum + ms, 0);

  // --- fallback ---
  const fallbackCount = tasks.filter((t) => t.fallback_applied).length;

  // --- per agent type (spec: "average latency per agent type") ---
  const perAgentType = registry.all().map((agent) => {
    const executions = agent.completed + agent.failed;
    return {
      type: agent.type,
      agent_id: agent.id,
      agent_name: agent.name,
      executions,
      successes: agent.completed,
      failures: agent.failed,
      success_rate: round(safeDivide(agent.completed, executions), 4),
      avg_latency_ms: Math.round(safeDivide(agent.totalLatencyMs, executions)),
      total_tokens: agent.totalTokens,
      total_cost_usd: round(microsToUsd(agent.costMicros), 6),
      cost_per_1k_tokens: agent.cost_per_1k_tokens,
    };
  });

  // --- cost ---
  const totalCostMicros = registry.all().reduce((sum, a) => sum + a.costMicros, 0);
  const totalTokens = registry.all().reduce((sum, a) => sum + a.totalTokens, 0);

  const successRate = safeDivide(completed, terminal);

  const pendingTasks = tasks.filter((t) => t.status === TASK_STATUS.PENDING);

  return {
    generated_at: new Date().toISOString(),

    totals: {
      tasks: tasks.length,
      pending: counts[TASK_STATUS.PENDING],
      processing: counts[TASK_STATUS.PROCESSING],
      completed,
      failed,
      terminal,
    },

    success_rate: round(successRate, 4),

    latency: {
      avg_ms: Math.round(safeDivide(totalLatency, latencies.length)),
      min_ms: latencies.length ? latencies[0] : 0,
      max_ms: latencies.length ? latencies[latencies.length - 1] : 0,
      p95_ms: percentile(latencies, 95),
      samples: latencies.length,
    },

    fallback: {
      count: fallbackCount,
      rate: round(safeDivide(fallbackCount, tasks.length), 4),
      // Framed as a ratio, not a bare count: "7 of 168" reads as a governed,
      // measured behaviour rather than an unexplained number of incidents.
      label: `${fallbackCount} of ${tasks.length}`,
    },

    cost: {
      total_tokens: totalTokens,
      total_usd: round(microsToUsd(totalCostMicros), 6),
    },

    per_agent_type: perAgentType,

    queue: {
      depth: pendingTasks.length,
      high_priority_waiting: pendingTasks.filter((t) => t.priority === 'HIGH').length,
      in_flight: dispatcher?.inflight?.size ?? counts[TASK_STATUS.PROCESSING],
    },

    system_health: assessHealth({ registry, successRate, terminal, failed }),
  };
}

/**
 * System health.
 *
 * Deliberately reports HEALTHY on an empty system: "no tasks yet" is not a
 * degraded state, and showing CRITICAL on a freshly-started server because
 * 0/0 evaluated badly would train an operator to ignore the indicator.
 */
function assessHealth({ registry, successRate, terminal, failed }) {
  const agentsInError = registry.all().filter((a) => registry.statusOf(a) === 'ERROR');

  if (terminal === 0) {
    return { status: HEALTH.HEALTHY, reason: 'No tasks processed yet.', agents_in_error: agentsInError.length };
  }

  let status;
  let reason;

  if (successRate >= 0.9) {
    status = HEALTH.HEALTHY;
    reason = `Success rate ${(successRate * 100).toFixed(1)}% across ${terminal} completed tasks.`;
  } else if (successRate >= 0.7) {
    status = HEALTH.DEGRADED;
    reason = `Success rate ${(successRate * 100).toFixed(1)}% is below the 90% target (${failed} failures).`;
  } else {
    status = HEALTH.CRITICAL;
    reason = `Success rate ${(successRate * 100).toFixed(1)}% is critically low (${failed} failures).`;
  }

  // An agent actively in ERROR degrades a system that would otherwise look fine
  // on a historical average.
  if (status === HEALTH.HEALTHY && agentsInError.length > 0) {
    status = HEALTH.DEGRADED;
    reason = `${agentsInError.length} agent(s) currently in ERROR: ${agentsInError.map((a) => a.name).join(', ')}.`;
  }

  return { status, reason, agents_in_error: agentsInError.length };
}

export { HEALTH };
