import { Num } from './Num.jsx';
import { FALLBACK_GLYPH, HEALTH_META, metaFor, TASK_STATUS_META } from '../lib/constants.js';
import {
  DASH,
  formatCount,
  formatLatency,
  formatPercent,
  formatTokens,
  formatUsd,
} from '../lib/format.js';

/** One metric card: label, primary figure, and up to two dense sub-lines. */
function Card({ label, children, sub, className = '' }) {
  return (
    <article className={`card metric ${className}`.trim()}>
      <h3 className="metric__label">{label}</h3>
      <div className="metric__value">{children}</div>
      {sub ? <div className="metric__sub">{sub}</div> : null}
    </article>
  );
}

/**
 * The five headline metrics.
 *
 * Every card renders something sensible with `metrics === null` (before the
 * first snapshot) and with a completely empty system: em-dashes, never `NaN`,
 * never a blank card, and never a fabricated `0.0%` success rate for a system
 * that has not run anything yet.
 */
export function MetricsPanel({ metrics }) {
  const totals = metrics?.totals ?? {};
  const latency = metrics?.latency ?? {};
  const cost = metrics?.cost ?? {};
  const fallback = metrics?.fallback ?? {};
  const queue = metrics?.queue ?? {};
  const health = metrics?.system_health ?? null;

  const terminalCount = totals.terminal ?? 0;
  const hasTerminal = terminalCount > 0;
  const hasLatencySamples = (latency.samples ?? 0) > 0;
  const totalTasks = totals.tasks ?? 0;

  const healthMeta = health ? metaFor(HEALTH_META, health.status) : null;

  return (
    <section className="metrics" aria-label="System metrics">
      <Card
        label="Total Tasks"
        sub={
          <>
            <span className="metric__stat">
              <span aria-hidden="true">{TASK_STATUS_META.PENDING.glyph}</span>{' '}
              <Num w={5}>{formatCount(totals.pending ?? 0)}</Num> pending
            </span>
            <span className="metric__stat">
              <span aria-hidden="true">{TASK_STATUS_META.PROCESSING.glyph}</span>{' '}
              <Num w={5}>{formatCount(totals.processing ?? 0)}</Num> running
            </span>
            <span className="metric__stat">
              <span aria-hidden="true">{TASK_STATUS_META.COMPLETED.glyph}</span>{' '}
              <Num w={5}>{formatCount(totals.completed ?? 0)}</Num> done
            </span>
            <span className="metric__stat">
              <span aria-hidden="true">{TASK_STATUS_META.FAILED.glyph}</span>{' '}
              <Num w={5}>{formatCount(totals.failed ?? 0)}</Num> failed
            </span>
            <span className="metric__stat metric__stat--queue">
              queue <Num w={5}>{formatCount(queue.depth ?? 0)}</Num> · high{' '}
              <Num w={5}>{formatCount(queue.high_priority_waiting ?? 0)}</Num> · in flight{' '}
              <Num w={5}>{formatCount(queue.in_flight ?? 0)}</Num>
            </span>
          </>
        }
      >
        <Num w={6}>{formatCount(totalTasks)}</Num>
      </Card>

      <Card
        label="Success Rate"
        sub={
          // Fallbacks are shown as a RATIO, never a bare count: "7" is
          // meaningless without a denominator, while "7 of 168 · 4.2%" tells
          // you whether routing is healthy or quietly degrading.
          <span className="metric__stat metric__stat--fallback">
            <span aria-hidden="true">{FALLBACK_GLYPH}</span> Fallbacks{' '}
            <span className="mono">{fallback.label ?? `0 of ${totalTasks}`}</span> ·{' '}
            <Num w={6}>{formatPercent(fallback.rate, totalTasks > 0)}</Num>
          </span>
        }
      >
        <Num w={6} tone={hasTerminal ? undefined : 'muted'}>
          {formatPercent(metrics?.success_rate, hasTerminal)}
        </Num>
      </Card>

      <Card
        label="Avg Latency"
        sub={
          <>
            <span className="metric__stat">
              p95 <Num w={8}>{formatLatency(hasLatencySamples ? latency.p95_ms : null)}</Num>
            </span>
            <span className="metric__stat">
              min <Num w={8}>{formatLatency(hasLatencySamples ? latency.min_ms : null)}</Num>
            </span>
            <span className="metric__stat">
              max <Num w={8}>{formatLatency(hasLatencySamples ? latency.max_ms : null)}</Num>
            </span>
            <span className="metric__stat">
              n <Num w={5}>{formatCount(latency.samples ?? 0)}</Num>
            </span>
          </>
        }
      >
        <Num w={8}>{formatLatency(hasLatencySamples ? latency.avg_ms : null)}</Num>
      </Card>

      <Card
        label="Total Cost"
        sub={
          <>
            <span className="metric__stat">
              <Num w={10}>{formatTokens(cost.total_tokens ?? 0)}</Num> tokens
            </span>
            <span className="metric__stat">
              avg / task{' '}
              <Num w={8}>
                {formatUsd(totalTasks > 0 ? (cost.total_usd ?? 0) / totalTasks : null)}
              </Num>
            </span>
          </>
        }
      >
        <Num w={10}>{formatUsd(cost.total_usd ?? 0)}</Num>
      </Card>

      <Card
        label="System Health"
        className={healthMeta ? `metric--health tone-${healthMeta.tone}` : 'metric--health'}
        sub={<span className="metric__reason">{health?.reason ?? 'Awaiting first snapshot.'}</span>}
      >
        {healthMeta ? (
          <span className={`health tone-${healthMeta.tone}`}>
            <span className="health__glyph" aria-hidden="true">
              {healthMeta.glyph}
            </span>
            <span className="health__word">{healthMeta.label}</span>
          </span>
        ) : (
          <span className="health tone-muted">
            <span className="health__word">{DASH}</span>
          </span>
        )}
      </Card>
    </section>
  );
}
