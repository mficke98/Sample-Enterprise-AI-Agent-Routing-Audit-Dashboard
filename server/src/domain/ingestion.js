import { emit, EVENTS } from '../lib/bus.js';
import { validateTaskInput } from './validation.js';
import { selectAgent } from './router.js';
import { toPublicTask } from './serializers.js';

export class ValidationError extends Error {
  constructor(errors) {
    super('Task validation failed.');
    this.name = 'ValidationError';
    this.code = 'VALIDATION_FAILED';
    this.httpStatus = 400;
    this.errors = errors;
  }
}

export class RoutingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoutingError';
    this.code = 'NO_ELIGIBLE_AGENT';
    this.httpStatus = 503;
  }
}

/**
 * Ingest one task: validate, route to an agent, persist as PENDING.
 *
 * Routing happens at ingestion (not at dispatch) so that the assignment is
 * visible in the record the moment the caller gets their 201 back -- an audit
 * pipeline should be able to answer "who was this given to?" immediately,
 * without waiting for a worker to pick it up.
 */
export function ingestTask(input, { registry, taskStore }) {
  const { valid, errors, value } = validateTaskInput(input);
  if (!valid) throw new ValidationError(errors);

  const { agent, note } = selectAgent(value.type, { registry });
  if (!agent) {
    throw new RoutingError(`No agent available to handle type "${value.type}" and no GENERAL fallback is configured.`);
  }

  const task = taskStore.create({
    ...value,
    assignedAgent: agent,
    routingNote: note,
  });

  emit(EVENTS.TASK_CREATED, toPublicTask(task));
  return task;
}
