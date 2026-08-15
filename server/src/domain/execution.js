import { config, TASK_STATUS } from '../config.js';
import { emit, EVENTS } from '../lib/bus.js';
import { createRng } from '../lib/rng.js';
import { simulateExecution, OUTCOME, microsToUsd } from './executor.js';
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

  // Failure handling. Fallback re-routing is layered on top of this in
  // handleFailure(), keeping the success path above untouched.
  return handleFailure(task, attempt, { registry, taskStore });
}

/**
 * What happens when an attempt fails.
 *
 * In this commit: the task terminates as FAILED. The fallback re-routing
 * requirement extends exactly this function.
 */
function handleFailure(task, attempt, { taskStore }) {
  finaliseFailure(task, taskStore, attempt.error);
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
