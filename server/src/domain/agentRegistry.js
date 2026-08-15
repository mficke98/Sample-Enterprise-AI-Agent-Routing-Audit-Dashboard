import { config, AGENT_STATUS, FALLBACK_TYPE } from '../config.js';
import { readJsonc } from '../lib/jsonc.js';
import { emit, EVENTS } from '../lib/bus.js';

/**
 * In-memory agent registry.
 *
 * Holds the static config loaded from agents_config.json plus the live
 * bookkeeping the dashboard needs: how many slots are currently occupied and
 * whether the agent recently errored.
 *
 * Agent status is DERIVED, never stored. Storing a status field invites the
 * classic bug where a crash mid-execution leaves an agent stuck in PROCESSING
 * forever. Here, status is a pure function of (active count, last error time),
 * so it is always consistent with reality.
 */

const REQUIRED_FIELDS = ['id', 'name', 'type', 'max_concurrent', 'cost_per_1k_tokens'];

function validateAgent(raw, index) {
  const errors = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [`agent[${index}] must be an object`];
  }
  for (const field of REQUIRED_FIELDS) {
    if (raw[field] === undefined || raw[field] === null) errors.push(`agent[${index}] missing "${field}"`);
  }
  if (raw.max_concurrent !== undefined) {
    if (!Number.isInteger(raw.max_concurrent) || raw.max_concurrent < 1) {
      errors.push(`agent[${index}] max_concurrent must be an integer >= 1 (got ${raw.max_concurrent})`);
    }
  }
  if (raw.cost_per_1k_tokens !== undefined) {
    if (!Number.isFinite(raw.cost_per_1k_tokens) || raw.cost_per_1k_tokens < 0) {
      errors.push(`agent[${index}] cost_per_1k_tokens must be a non-negative number`);
    }
  }
  return errors;
}

export class AgentRegistry {
  constructor() {
    this.agents = new Map();
  }

  /** Load from a file path (production) or a plain array (tests). */
  load(source) {
    const raw = typeof source === 'string' ? readJsonc(source) : source;

    if (!Array.isArray(raw)) throw new Error('agents_config must be a JSON array of agents');
    if (raw.length === 0) throw new Error('agents_config is empty - there would be nothing to route to');

    const errors = [];
    raw.forEach((agent, i) => errors.push(...validateAgent(agent, i)));
    if (errors.length) throw new Error(`Invalid agents_config:\n  - ${errors.join('\n  - ')}`);

    this.agents.clear();
    for (const agent of raw) {
      if (this.agents.has(agent.id)) throw new Error(`Duplicate agent id "${agent.id}" in agents_config`);
      this.agents.set(agent.id, {
        id: agent.id,
        name: agent.name,
        type: String(agent.type).toUpperCase(),
        max_concurrent: agent.max_concurrent,
        cost_per_1k_tokens: agent.cost_per_1k_tokens,
        // Live state
        active: 0,
        completed: 0,
        failed: 0,
        totalLatencyMs: 0,
        totalTokens: 0,
        costMicros: 0,
        lastErrorAt: null,
      });
    }

    if (!this.fallbackAgent()) {
      // Not fatal: the system still routes normally, but a failed task has
      // nowhere to fall back to and will terminate as FAILED.
      console.warn(
        `[registry] No ${FALLBACK_TYPE} agent found. Fallback routing is disabled; failed tasks will terminate as FAILED.`,
      );
    }
    return this.list();
  }

  get(id) {
    return this.agents.get(id) ?? null;
  }

  /** Raw internal records - callers must not mutate. */
  all() {
    return [...this.agents.values()];
  }

  byType(type) {
    const wanted = String(type ?? '').toUpperCase();
    return this.all().filter((a) => a.type === wanted);
  }

  fallbackAgent() {
    return this.all().find((a) => a.type === FALLBACK_TYPE) ?? null;
  }

  knownTypes() {
    return [...new Set(this.all().map((a) => a.type))];
  }

  hasCapacity(id) {
    const agent = this.get(id);
    return agent ? agent.active < agent.max_concurrent : false;
  }

  freeSlots(id) {
    const agent = this.get(id);
    return agent ? Math.max(0, agent.max_concurrent - agent.active) : 0;
  }

  /**
   * Derived status. PROCESSING outranks a recent ERROR: an agent actively
   * working is more useful information than one that failed a moment ago.
   */
  statusOf(agent, now = Date.now()) {
    if (!agent) return AGENT_STATUS.IDLE;
    if (agent.active > 0) return AGENT_STATUS.PROCESSING;
    if (agent.lastErrorAt !== null && now - agent.lastErrorAt < config.errorStickyMs) {
      return AGENT_STATUS.ERROR;
    }
    return AGENT_STATUS.IDLE;
  }

  /**
   * Claim a concurrency slot. Returns false if the agent is saturated, so the
   * caller can leave the task queued rather than exceeding max_concurrent.
   */
  acquire(id) {
    const agent = this.get(id);
    if (!agent || agent.active >= agent.max_concurrent) return false;
    agent.active += 1;
    this.emitStatus(agent);
    return true;
  }

  release(id, { failed = false, latencyMs = 0, tokens = 0, costMicros = 0 } = {}) {
    const agent = this.get(id);
    if (!agent) return;
    agent.active = Math.max(0, agent.active - 1);
    agent.totalLatencyMs += latencyMs;
    agent.totalTokens += tokens;
    agent.costMicros += costMicros;
    if (failed) {
      agent.failed += 1;
      agent.lastErrorAt = Date.now();
    } else {
      agent.completed += 1;
    }
    this.emitStatus(agent);
  }

  emitStatus(agent) {
    emit(EVENTS.AGENT_STATUS, this.toPublic(agent));
  }

  /** Shape sent to the dashboard. */
  toPublic(agent, now = Date.now()) {
    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      status: this.statusOf(agent, now),
      active: agent.active,
      max_concurrent: agent.max_concurrent,
      capacity_label: `${agent.active}/${agent.max_concurrent}`,
      utilization: agent.max_concurrent ? agent.active / agent.max_concurrent : 0,
      cost_per_1k_tokens: agent.cost_per_1k_tokens,
      completed: agent.completed,
      failed: agent.failed,
      is_fallback_agent: agent.type === FALLBACK_TYPE,
    };
  }

  listPublic() {
    const now = Date.now();
    return this.all().map((a) => this.toPublic(a, now));
  }

  list() {
    return this.listPublic();
  }

  /** Test helper - clears live counters without reloading config. */
  resetState() {
    for (const agent of this.all()) {
      Object.assign(agent, {
        active: 0,
        completed: 0,
        failed: 0,
        totalLatencyMs: 0,
        totalTokens: 0,
        costMicros: 0,
        lastErrorAt: null,
      });
    }
  }
}

export const registry = new AgentRegistry();
