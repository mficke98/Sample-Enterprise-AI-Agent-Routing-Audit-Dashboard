import { CapacityMeter } from './CapacityMeter.jsx';
import { Num } from './Num.jsx';
import { StatePill } from './StatePill.jsx';
import { AGENT_STATUS_META, FALLBACK_GLYPH, TASK_STATUS_META } from '../lib/constants.js';
import { formatCount, formatRate1k } from '../lib/format.js';

function AgentCard({ agent }) {
  const processing = agent.status === 'PROCESSING';

  return (
    <article className={`card agent agent--${(agent.status || '').toLowerCase()}`}>
      <header className="agent__head">
        <span className="agent__ident">
          {/* The pulse is an 8px dot and nothing else. It exists on exactly the
              four agent cards, never on stream rows -- a looping animation per
              row would be both a GPU cost and an attention sink. */}
          <span
            className={`agent__pulse${processing ? ' agent__pulse--on' : ''}`}
            aria-hidden="true"
          />
          <span className="agent__name">{agent.name}</span>
        </span>
        <StatePill table={AGENT_STATUS_META} value={agent.status} />
      </header>

      <div className="agent__meta">
        <span className="tag tag--type">{agent.type}</span>
        {agent.is_fallback_agent ? (
          <span className="tag tag--fallback" title="Tasks that fail elsewhere are re-routed here">
            <span aria-hidden="true">{FALLBACK_GLYPH}</span> FALLBACK TARGET
          </span>
        ) : null}
        <span className="agent__rate mono">{formatRate1k(agent.cost_per_1k_tokens)}</span>
      </div>

      <CapacityMeter active={agent.active} max={agent.max_concurrent} />

      <footer className="agent__tally">
        <span>
          <span aria-hidden="true">{TASK_STATUS_META.COMPLETED.glyph}</span>{' '}
          <Num w={5}>{formatCount(agent.completed)}</Num>
          <span className="sr-only"> completed</span>
        </span>
        <span className={agent.failed > 0 ? 'tone-error' : undefined}>
          <span aria-hidden="true">{TASK_STATUS_META.FAILED.glyph}</span>{' '}
          <Num w={5}>{formatCount(agent.failed)}</Num>
          <span className="sr-only"> failed</span>
        </span>
      </footer>
    </article>
  );
}

/** The four-agent roster with live status and concurrency. */
export function AgentBoard({ agents }) {
  return (
    <section className="agents" aria-label="Agent roster">
      {agents.length === 0 ? (
        <p className="empty empty--inline">Waiting for the agent roster…</p>
      ) : (
        agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)
      )}
    </section>
  );
}
