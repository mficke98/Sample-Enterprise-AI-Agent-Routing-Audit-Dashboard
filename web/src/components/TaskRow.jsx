import { memo, useEffect, useRef, useState } from 'react';

import { Num } from './Num.jsx';
import { PriorityTag } from './PriorityTag.jsx';
import { StatePill } from './StatePill.jsx';
import { TaskDetails } from './TaskDetails.jsx';
import { FALLBACK_GLYPH, ROUTE_ARROW, TASK_STATUS_META } from '../lib/constants.js';
import { formatClock, formatLatency, formatUsd } from '../lib/format.js';
import { describeRouting, isTerminal } from '../lib/routing.js';

/** One-shot decay durations, mirrored in styles.css. */
const DECAY_MS = { COMPLETED: 600, FAILED: 900 };

/**
 * The routing line: `TAX ⟶ GENERAL`, original struck through.
 *
 * Struck-through-plus-arrow is readable in one glance and survives grayscale,
 * which a colour swap between two agent names would not.
 */
function RouteTrace({ task }) {
  const { from, to } = describeRouting(task);
  if (!from || !to) return null;

  const fromLabel = from.type || from.name;
  const toLabel = to.type || to.name;

  return (
    <span className="route">
      <span className="route__from" title={from.name}>
        {fromLabel}
      </span>
      <span className="route__arrow" aria-hidden="true">
        {ROUTE_ARROW}
      </span>
      <span className="route__to" title={to.name}>
        {toLabel}
      </span>
      <span className="sr-only">{`re-routed from ${from.name} to ${to.name}`}</span>
    </span>
  );
}

function TaskRowBase({ task, expanded, onToggle }) {
  const fallback = Boolean(task.fallback_applied);
  const meta = TASK_STATUS_META[task.status];

  // --- one-shot terminal decay ------------------------------------------
  // When a task reaches a terminal state its row flashes its status colour
  // once and decays to transparent. It is a one-shot precisely so the stream
  // does not end up with dozens of permanently glowing rows; the state itself
  // is already carried by the pill, so the flash is pure "this just changed".
  const [flash, setFlash] = useState(null);
  const previousStatus = useRef(task.status);

  useEffect(() => {
    const before = previousStatus.current;
    previousStatus.current = task.status;
    if (before === task.status || !isTerminal(task.status)) return;

    const variant = fallback ? 'FAILED' : task.status; // fallback decays slowly too
    setFlash(variant);
    const timer = setTimeout(() => setFlash(null), DECAY_MS[variant] ?? 600);
    return () => clearTimeout(timer);
  }, [task.status, fallback]);

  const classes = ['row'];
  if (fallback) classes.push('row--fallback');
  if (expanded) classes.push('row--expanded');
  if (flash) classes.push(`row--decay-${flash.toLowerCase()}`);

  const { from, reason } = describeRouting(task);

  return (
    <li className={classes.join(' ')}>
      <button
        type="button"
        className="row__main"
        onClick={() => onToggle(task.id)}
        aria-expanded={expanded}
        aria-controls={`detail-${task.id}`}
      >
        <span className="row__time mono">{formatClock(task.created_at)}</span>

        <PriorityTag value={task.priority} />

        <StatePill table={TASK_STATUS_META} value={task.status} />

        <span className="row__body">
          <span className="row__titleline">
            <span className="row__title">{task.title}</span>
            {fallback ? (
              <span className="chip chip--fallback">
                <span aria-hidden="true">{FALLBACK_GLYPH}</span> FALLBACK
              </span>
            ) : null}
          </span>

          {fallback ? (
            <>
              <RouteTrace task={task} />
              {/* Fifth signal: plain language. Someone who missed the border,
                  the hatch, the chip and the arrow still reads the sentence. */}
              <span className="row__reroute">
                Rerouted — {from?.name ?? 'specialist agent'} {reason}
              </span>
            </>
          ) : (
            <span className="row__agent">
              <span className="tag tag--type">{task.type}</span>
              <span className="row__agentname">{task.assigned_agent_name ?? 'unassigned'}</span>
            </span>
          )}
        </span>

        <Num w={8} className="row__latency">
          {formatLatency(task.latency_ms)}
        </Num>
        <Num w={8} className="row__cost">
          {formatUsd(task.total_cost_usd)}
        </Num>

        <span className="row__chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>

        {/* One coherent sentence for assistive tech, since the visual row is a
            deliberately terse grid of glyphs and columns. */}
        <span className="sr-only">
          {`${task.title}. ${meta?.label ?? task.status}. ${
            fallback ? 'Fallback applied. ' : ''
          }Agent ${task.assigned_agent_name ?? 'unassigned'}.`}
        </span>
      </button>

      {expanded ? (
        <div className="row__detail" id={`detail-${task.id}`}>
          <TaskDetails task={task} />
        </div>
      ) : null}
    </li>
  );
}

// Rows are memoised: a metrics frame arrives several times a second and must
// not re-render 200 rows that did not change.
export const TaskRow = memo(TaskRowBase);
