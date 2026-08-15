import { TASK_STATUS } from '../config.js';
import { executeTask } from './execution.js';

/**
 * Capacity-aware priority dispatcher.
 *
 * Walks PENDING tasks in priority order (HIGH > MEDIUM > LOW, FIFO within a
 * tier) and launches each one whose assigned agent has a free concurrency slot.
 *
 * The important behaviour is that it SKIPS a task whose agent is saturated
 * rather than stopping at it. A strict queue would head-of-line block: one HIGH
 * TAX task waiting on a full Tax agent would stall every MEDIUM SECURITY task
 * behind it, even though the Security agent is completely idle. Skipping keeps
 * every agent busy while still honouring priority wherever there is a genuine
 * choice.
 *
 * Starvation is bounded because the within-tier ordering is FIFO by monotonic
 * id: a skipped task keeps its place and is retried on the very next drain, so
 * it goes first the moment its agent frees up.
 */
export class Dispatcher {
  constructor({ registry, taskStore, intervalMs = 200, rng, sleep } = {}) {
    this.registry = registry;
    this.taskStore = taskStore;
    this.intervalMs = intervalMs;
    this.rng = rng;
    this.sleep = sleep;

    this.timer = null;
    this.stopped = false;
    this.draining = false;
    this.inflight = new Set();

    /**
     * Background dispatch is opt-in via start().
     *
     * `stopped` alone is not enough to gate this: it defaults to false, so a
     * constructed-but-never-started dispatcher would still act on kick() from
     * the ingest route and auto-execute tasks that the caller expected to stay
     * PENDING. Explicit drain()/runToCompletion() calls remain available
     * without start(), since those are direct commands rather than background
     * activity.
     */
    this.running = false;

    this.stats = { launched: 0, drains: 0, skippedAtCapacity: 0 };
  }

  start() {
    if (this.timer) return this;
    this.stopped = false;
    this.running = true;
    // A periodic sweep is a safety net only; the hot path is kick() on ingest
    // and on each completion. unref() so it never holds the process open.
    this.timer = setInterval(() => this.drain(), this.intervalMs);
    this.timer.unref?.();
    this.drain();
    return this;
  }

  stop() {
    this.stopped = true;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this;
  }

  /**
   * Request a drain on the next tick, coalescing bursts of ingests.
   * No-op unless background dispatch is actually running.
   */
  kick() {
    if (!this.running || this.stopped) return;
    if (this.kickScheduled) return;
    this.kickScheduled = true;
    setImmediate(() => {
      this.kickScheduled = false;
      this.drain();
    });
  }

  /**
   * One dispatch pass. Synchronous by design: executeTask claims its agent slot
   * before its first await, so capacity seen later in this same loop is already
   * up to date and two tasks can never both be handed the last slot.
   *
   * @returns {number} how many tasks were launched
   */
  drain() {
    if (this.stopped || this.draining) return 0;
    this.draining = true;
    let launched = 0;

    try {
      this.stats.drains += 1;
      for (const task of this.taskStore.pendingByPriority()) {
        // Status may have changed since the snapshot was taken.
        if (task.status !== TASK_STATUS.PENDING) continue;

        const agent = this.registry.get(task.assigned_agent_id);
        if (!agent) continue;

        if (!this.registry.hasCapacity(agent.id)) {
          this.stats.skippedAtCapacity += 1;
          continue; // skip, do NOT block the rest of the queue
        }

        this.launch(task);
        launched += 1;
      }
    } finally {
      this.draining = false;
    }

    return launched;
  }

  launch(task) {
    this.stats.launched += 1;

    const run = executeTask(task.id, {
      registry: this.registry,
      taskStore: this.taskStore,
      rng: this.rng,
      sleep: this.sleep,
    })
      .catch((err) => {
        // AGENT_AT_CAPACITY here is benign and self-correcting -- it means the
        // slot went to someone else between the check and the claim. The task
        // is still PENDING and will be retried on the next drain.
        if (err?.code !== 'AGENT_AT_CAPACITY') {
          console.error(`[dispatcher] task ${task.id} failed to execute:`, err.message);
        }
      })
      .finally(() => {
        this.inflight.delete(run);
        // A slot just freed -- immediately reconsider the queue.
        this.kick();
      });

    this.inflight.add(run);
    return run;
  }

  /** Wait for everything currently executing to settle. Test/shutdown helper. */
  async idle() {
    while (this.inflight.size > 0) {
      await Promise.all([...this.inflight]);
    }
  }

  /**
   * Drive the queue to completion without the background timer.
   * Used by tests to get deterministic, fully-drained state.
   */
  async runToCompletion({ maxPasses = 1000 } = {}) {
    for (let pass = 0; pass < maxPasses; pass += 1) {
      this.drain();
      if (this.inflight.size === 0) {
        // Nothing running and nothing dispatchable -> the queue is as drained
        // as it can get (remaining PENDING tasks have no eligible agent).
        if (this.drain() === 0) return;
      }
      await this.idle();
    }
    throw new Error('runToCompletion exceeded maxPasses - possible dispatch loop');
  }

  queueDepth() {
    return this.taskStore.pendingByPriority().length;
  }
}
