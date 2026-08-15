import { FALLBACK_TYPE } from '../config.js';

/**
 * Agent selection. Deliberately PURE with respect to capacity: this function
 * answers "which agent is responsible for this work?", never "is there a free
 * slot right now?". Capacity is the dispatcher's job.
 *
 * Keeping those two concerns apart is what made the mid-build fallback
 * requirement cheap -- fallback is just another call to this same function with
 * the failed agent excluded.
 */

/**
 * @param {string} type - requested task type (any case; may be unknown/missing)
 * @param {object} opts
 * @param {import('./agentRegistry.js').AgentRegistry} opts.registry
 * @param {string[]} [opts.exclude] - agent ids that must not be selected
 * @returns {{agent: object|null, note: string|null, reason: string}}
 */
export function selectAgent(type, { registry, exclude = [] }) {
  const requested = String(type ?? '').trim().toUpperCase();
  const excluded = new Set(exclude);

  const specialists = registry.byType(requested).filter((a) => !excluded.has(a.id));

  if (specialists.length > 0) {
    return {
      agent: pickLeastLoaded(specialists),
      note: null,
      reason: 'TYPE_MATCH',
    };
  }

  const fallback = registry.fallbackAgent();
  if (fallback && !excluded.has(fallback.id)) {
    const typeIsKnown = registry.knownTypes().includes(requested);
    return {
      agent: fallback,
      note: typeIsKnown
        ? `No eligible ${requested} agent available; routed to ${FALLBACK_TYPE}.`
        : `Unknown task type "${type}"; routed to ${FALLBACK_TYPE}.`,
      reason: typeIsKnown ? 'FALLBACK_NO_SPECIALIST' : 'FALLBACK_UNKNOWN_TYPE',
    };
  }

  // Nothing left: either no GENERAL agent is configured, or the GENERAL agent
  // is itself the excluded one (i.e. the fallback already ran and failed).
  return {
    agent: null,
    note: 'No eligible agent available.',
    reason: 'NO_AGENT',
  };
}

/**
 * Among equally-eligible agents, prefer the one with the most headroom. With
 * the provided config there is exactly one agent per type so this never binds,
 * but it means adding a second TAX agent balances load rather than hammering
 * whichever happens to be first in the file.
 */
function pickLeastLoaded(agents) {
  return [...agents].sort((a, b) => {
    const freeA = a.max_concurrent - a.active;
    const freeB = b.max_concurrent - b.active;
    if (freeA !== freeB) return freeB - freeA;
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * Fallback target for a task whose attempt on `failedAgentId` just failed.
 * Returns null when fallback is impossible, which the caller must treat as
 * terminal failure rather than retrying forever.
 */
export function selectFallbackAgent(type, { registry, failedAgentId }) {
  const failedAgent = registry.get(failedAgentId);

  // A GENERAL agent has no one to fall back to -- it IS the fallback. Retrying
  // it against itself would loop; this is the loop guard's second line of
  // defence (the first being the fallback_applied flag).
  if (failedAgent && failedAgent.type === FALLBACK_TYPE) {
    return { agent: null, note: 'Fallback agent itself failed; no further routing.', reason: 'FALLBACK_EXHAUSTED' };
  }

  const fallback = registry.fallbackAgent();
  if (!fallback) {
    return { agent: null, note: 'No GENERAL agent configured; cannot fall back.', reason: 'NO_FALLBACK_CONFIGURED' };
  }

  return {
    agent: fallback,
    note: `Re-routed from ${failedAgent?.name ?? failedAgentId} after failure.`,
    reason: 'FALLBACK_APPLIED',
  };
}
