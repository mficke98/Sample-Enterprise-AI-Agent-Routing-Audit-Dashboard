import { TASK_STATUS, PRIORITY_RANK } from '../config.js';

/**
 * In-memory task store.
 *
 * The `attempts` array is the load-bearing design decision in this whole
 * codebase. Recording each execution as an appended entry -- rather than
 * overwriting a single `result` field -- is what makes the fallback-routing
 * requirement a small additive change instead of a rewrite, and it is what
 * gives the audit trail its actual value: you can see that a task was tried on
 * the Tax agent, failed, and succeeded on the General agent, with the latency
 * and cost of both attempts preserved.
 */
export class TaskStore {
  constructor() {
    this.tasks = new Map();
    this.sequence = 0;
  }

  nextId() {
    this.sequence += 1;
    return `task-${String(this.sequence).padStart(4, '0')}`;
  }

  create({ title, type, payload, priority, assignedAgent, routingNote = null }) {
    const now = new Date().toISOString();
    const task = {
      id: this.nextId(),
      title,
      type,
      payload,
      priority,
      status: TASK_STATUS.PENDING,

      assigned_agent_id: assignedAgent?.id ?? null,
      assigned_agent_name: assignedAgent?.name ?? null,

      fallback_applied: false,
      routing_note: routingNote,

      attempts: [],
      result: null,
      error: null,

      latency_ms: null,
      total_tokens: 0,
      total_cost_usd: 0,

      created_at: now,
      started_at: null,
      completed_at: null,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  get(id) {
    return this.tasks.get(id) ?? null;
  }

  update(id, patch) {
    const task = this.get(id);
    if (!task) return null;
    Object.assign(task, patch);
    return task;
  }

  /** Append an execution attempt. Never overwrites a prior one. */
  addAttempt(id, attempt) {
    const task = this.get(id);
    if (!task) return null;
    task.attempts.push(attempt);
    return task;
  }

  all() {
    return [...this.tasks.values()];
  }

  list({ status, type, limit } = {}) {
    let results = this.all();
    if (status) {
      const wanted = String(status).toUpperCase().split(',');
      results = results.filter((t) => wanted.includes(t.status));
    }
    if (type) {
      const wanted = String(type).toUpperCase().split(',');
      results = results.filter((t) => wanted.includes(t.type));
    }
    // Newest first for the dashboard stream.
    results = results.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    if (Number.isFinite(limit) && limit > 0) results = results.slice(0, limit);
    return results;
  }

  /**
   * PENDING tasks in dispatch order: HIGH before MEDIUM before LOW, and
   * FIFO (by id, which is monotonic) within a priority tier so that a
   * long-waiting task is never starved by a newer one of equal priority.
   */
  pendingByPriority() {
    return this.all()
      .filter((t) => t.status === TASK_STATUS.PENDING)
      .sort((a, b) => {
        const rank = (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
        if (rank !== 0) return rank;
        return a.id.localeCompare(b.id);
      });
  }

  countsByStatus() {
    const counts = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 };
    for (const task of this.all()) {
      if (counts[task.status] !== undefined) counts[task.status] += 1;
    }
    return counts;
  }

  reset() {
    this.tasks.clear();
    this.sequence = 0;
  }
}

export const taskStore = new TaskStore();
