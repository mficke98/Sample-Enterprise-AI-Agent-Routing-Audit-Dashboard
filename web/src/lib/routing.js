/**
 * Routing derivations.
 *
 * A re-routed task carries the evidence of its own history in `attempts[]`:
 * the first attempt names the specialist that was tried, and
 * `assigned_agent_name` names whoever ended up owning it. The dashboard
 * reconstructs `TAX ⟶ GENERAL` from those two facts rather than asking the API
 * for a pre-formatted string, so the display stays correct even if the routing
 * rules change server-side.
 */

/**
 * @returns {{from: {name, type}|null, to: {name, type}|null, reason: string}}
 */
export function describeRouting(task) {
  const attempts = Array.isArray(task.attempts) ? task.attempts : [];

  // The originally-assigned specialist == the agent on the first attempt.
  // Before any attempt exists there is no history to show, so fall back to the
  // task's declared type.
  const first = attempts[0] ?? null;
  const from = first
    ? { name: first.agent_name, type: first.agent_type }
    : task.type
      ? { name: task.assigned_agent_name, type: task.type }
      : null;

  const last = attempts.length > 1 ? attempts[attempts.length - 1] : null;
  const to = last
    ? { name: last.agent_name, type: last.agent_type }
    : task.assigned_agent_name
      ? { name: task.assigned_agent_name, type: null }
      : null;

  // Prefer the server's own explanation; fall back to the failing attempt's
  // error so the sub-line is never empty on a fallback row.
  const reason = task.routing_note || first?.error || 'failed on its specialist agent';

  return { from, to, reason };
}

/** True when the task was re-routed to the GENERAL fallback agent. */
export const isFallback = (task) => Boolean(task && task.fallback_applied);

/** Terminal tasks are done moving; used to trigger the one-shot decay flash. */
export const isTerminal = (status) => status === 'COMPLETED' || status === 'FAILED';
