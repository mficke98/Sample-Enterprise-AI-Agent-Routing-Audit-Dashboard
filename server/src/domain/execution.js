import { config, TASK_STATUS } from '../config.js';
import { emit, EVENTS } from '../lib/bus.js';
import { createRng } from '../lib/rng.js';
import { simulateExecution, OUTCOME, microsToUsd } from './executor.js';
import { selectFallbackAgent } from './router.js';
import { toPublicTask } from './serializers.js';

/**
 * Orchestration layer: turns a simulated execution result into state changes on
 * the task record, the agent registry, and the event bus.
 *
 * Errors are typed so the HTTP layer can map them to status codes without
 * string-matching messages.
 */
export class ExecutionError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'ExecutionError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const sharedRng = createRng(config.seed);

/**
 * Execute a single attempt of a PENDING task on its assigned agent.
 *
 * Concurrency safety: the agent slot is acquired BEFORE any await, so two
 * concurrent callers cannot both observe free capacity and both proceed.
 * Node is single-threaded, so the check-and-increment in registry.acquire()
 * is atomic with respect to other tasks as long as nothing awaits inside it.
 */
export async function executeTask(taskId, { registry, taskStore, rng = sharedRng, sleep } = {}) {
  const task = taskStore.get(taskId);
  if (!task) throw new ExecutionError('TASK_NOT_FOUND', `No task with id "${taskId}".`, 404);

  if (task.status !== TASK_STATUS.PENDING) {
    throw new ExecutionError(
      'TASK_NOT_PENDING',
      `Task ${taskId} is ${task.status}; only PENDING tasks can be executed.`,
      409,
    );
  }

  const agent = registry.get(task.assigned_agent_id);
  if (!agent) {
    // Assigned agent vanished (config reloaded). Terminal rather than silently requeued.
    finaliseFailure(task, taskStore, 'No agent is assigned to this task.');
    throw new ExecutionError('NO_AGENT_ASSIGNED', `Task ${taskId} has no valid assigned agent.`, 409);
  }

  if (!registry.acquire(agent.id)) {
    throw new ExecutionError(
      'AGENT_AT_CAPACITY',
      `${agent.name} is at capacity (${agent.active}/${agent.max_concurrent}). Task remains PENDING.`,
      409,
    );
  }

  taskStore.update(taskId, {
    status: TASK_STATUS.PROCESSING,
    started_at: task.started_at ?? new Date().toISOString(),
  });
  emit(EVENTS.TASK_STARTED, toPublicTask(taskStore.get(taskId)));

  let attempt;
  try {
    attempt = await simulateExecution(agent, task, { rng, sleep });
  } catch (err) {
    // Defensive: an unexpected throw must not leak the concurrency slot.
    registry.release(agent.id, { failed: true });
    finaliseFailure(task, taskStore, `Executor crashed: ${err.message}`);
    emit(EVENTS.TASK_FAILED, toPublicTask(taskStore.get(taskId)));
    throw new ExecutionError('EXECUTOR_CRASHED', err.message, 500);
  }

  const failed = attempt.outcome !== OUTCOME.SUCCESS;
  registry.release(agent.id, {
    failed,
    latencyMs: attempt.latency_ms,
    tokens: attempt.tokens_used,
    costMicros: attempt.cost_micros,
  });

  taskStore.addAttempt(taskId, attempt);
  accumulateCost(task, attempt);

  if (!failed) {
    taskStore.update(taskId, {
      status: TASK_STATUS.COMPLETED,
      completed_at: new Date().toISOString(),
      latency_ms: totalLatency(task),
      result: {
        ...attempt.output,
        confidence: attempt.confidence,
        agent_id: attempt.agent_id,
        agent_name: attempt.agent_name,
        tokens_used: attempt.tokens_used,
        cost_usd: microsToUsd(attempt.cost_micros),
        latency_ms: attempt.latency_ms,
      },
      error: null,
    });
    emit(EVENTS.TASK_COMPLETED, toPublicTask(taskStore.get(taskId)));
    return taskStore.get(taskId);
  }

  // Failure handling, including fallback re-routing.
  return handleFailure(task, attempt, { registry, taskStore, rng, sleep });
}

/**
 * What happens when an attempt fails.
 *
 * Requirement: on ERROR or TIMEOUT, automatically re-route the task to the
 * General Secondary Agent and flag the record `fallback_applied: true`.
 *
 * Two independent loop guards, because an auto-retry that can retry itself is
 * how you build an infinite billing loop:
 *   1. `fallback_applied` -- a task falls back at most once, ever.
 *   2. selectFallbackAgent() refuses to route a GENERAL agent to itself.
 *
 * The failed attempt stays in `attempts`, so the audit trail shows both the
 * specialist's failure and the fallback's outcome, with the cost of each.
 */
async function handleFailure(task, attempt, { registry, taskStore, rng, sleep }) {
  // Already fell back once -- this failure is terminal.
  if (task.fallback_applied) {
    return terminate(task, taskStore, attempt.error);
  }

  const { agent: fallbackAgent, note } = selectFallbackAgent(task.type, {
    registry,
    failedAgentId: attempt.agent_id,
  });

  // No fallback target (the failed agent IS the fallback, or none is configured).
  if (!fallbackAgent) {
    return terminate(task, taskStore, attempt.error);
  }

  // Re-queue onto the fallback agent. Back to PENDING rather than executed
  // inline-regardless, so the General agent's own max_concurrent is still
  // respected -- a fallback storm must not be able to oversubscribe it.
  taskStore.update(task.id, {
    status: TASK_STATUS.PENDING,
    fallback_applied: true,
    assigned_agent_id: fallbackAgent.id,
    assigned_agent_name: fallbackAgent.name,
    routing_note: note,
    error: null,
    completed_at: null,
  });

  emit(EVENTS.TASK_FALLBACK, toPublicTask(taskStore.get(task.id)));

  // Attempt the fallback immediately so that a synchronous caller of
  // POST /:id/execute receives the final outcome in one response rather than a
  // task that is mysteriously PENDING again. Bounded to exactly one retry by
  // the fallback_applied flag set above.
  try {
    return await executeTask(task.id, { registry, taskStore, rng, sleep });
  } catch (err) {
    if (err.code === 'AGENT_AT_CAPACITY') {
      // The General agent is saturated right now. The task is correctly parked
      // as PENDING and the dispatcher will pick it up when a slot frees.
      return taskStore.get(task.id);
    }
    throw err;
  }
}

function terminate(task, taskStore, message) {
  finaliseFailure(task, taskStore, message);
  emit(EVENTS.TASK_FAILED, toPublicTask(taskStore.get(task.id)));
  return taskStore.get(task.id);
}

function finaliseFailure(task, taskStore, message) {
  taskStore.update(task.id, {
    status: TASK_STATUS.FAILED,
    completed_at: new Date().toISOString(),
    latency_ms: totalLatency(task),
    error: message,
  });
}

/** Total latency across every attempt -- the true wall-clock cost to the client. */
function totalLatency(task) {
  return task.attempts.reduce((sum, a) => sum + (a.latency_ms ?? 0), 0);
}

function accumulateCost(task, attempt) {
  task.total_tokens += attempt.tokens_used ?? 0;
  task._cost_micros = (task._cost_micros ?? 0) + (attempt.cost_micros ?? 0);
  task.total_cost_usd = microsToUsd(task._cost_micros);
}
