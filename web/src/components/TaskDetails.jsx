import { useState } from 'react';

import { Num } from './Num.jsx';
import { ApiError, executeTask } from '../lib/api.js';
import { metaFor, OUTCOME_META } from '../lib/constants.js';
import {
  DASH,
  formatClock,
  formatConfidence,
  formatCount,
  formatLatency,
  formatTokens,
  formatUsd,
} from '../lib/format.js';

/**
 * The audit trail for one task.
 *
 * This is the answer to "why did this cost what it cost, and who touched it?".
 * `attempts[]` is rendered as a real table because it IS tabular -- one row per
 * agent that held the task, in order, with the outcome, latency, tokens and
 * cost of each. On a re-routed task the first row is the failure and the second
 * is the rescue, and the two are legible side by side.
 */
export function TaskDetails({ task }) {
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);

  const attempts = Array.isArray(task.attempts) ? task.attempts : [];
  const findings = Array.isArray(task.result?.findings) ? task.result.findings : [];

  const handleExecute = async () => {
    setRunError(null);
    setRunning(true);
    try {
      await executeTask(task.id);
      // No local state update needed: the resulting task.* events arrive on
      // the stream and merge into the same record this row renders.
    } catch (err) {
      setRunError(
        err instanceof ApiError && err.status === 409
          ? 'Already picked up by the dispatcher — only PENDING tasks can be run manually.'
          : err instanceof ApiError
            ? err.message
            : 'Could not execute this task.'
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="detail">
      <dl className="detail__facts">
        <div>
          <dt>Task id</dt>
          <dd className="mono">{task.id}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd className="mono">{formatClock(task.created_at)}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd className="mono">{task.completed_at ? formatClock(task.completed_at) : DASH}</dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd className="mono">{formatCount(task.attempt_count ?? attempts.length)}</dd>
        </div>
      </dl>

      <section className="detail__block">
        <h4 className="detail__heading">Payload</h4>
        <p className="detail__payload">{task.payload || DASH}</p>
      </section>

      {task.routing_note ? (
        <section className="detail__block">
          <h4 className="detail__heading">Routing note</h4>
          <p className="detail__note">{task.routing_note}</p>
        </section>
      ) : null}

      <section className="detail__block">
        <h4 className="detail__heading">
          Attempts <span className="detail__count mono">({attempts.length})</span>
        </h4>
        {attempts.length === 0 ? (
          <p className="detail__empty">No attempt has been made yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="attempts">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Outcome</th>
                  <th scope="col" className="ta-right">
                    Latency
                  </th>
                  <th scope="col" className="ta-right">
                    Tokens
                  </th>
                  <th scope="col" className="ta-right">
                    Cost
                  </th>
                  <th scope="col" className="ta-right">
                    Conf.
                  </th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt, index) => {
                  const meta = metaFor(OUTCOME_META, attempt.outcome);
                  return (
                    <tr key={`${attempt.at ?? index}-${index}`}>
                      <td className="mono">{index + 1}</td>
                      <td>
                        <span className="attempts__agent">{attempt.agent_name}</span>
                        <span className="attempts__type mono">{attempt.agent_type}</span>
                        {attempt.error ? (
                          <span className="attempts__error">{attempt.error}</span>
                        ) : null}
                      </td>
                      <td>
                        <span className={`outcome tone-${meta.tone}`}>
                          <span aria-hidden="true">{meta.glyph}</span> {meta.label}
                        </span>
                      </td>
                      <td className="ta-right">
                        <Num w={8}>{formatLatency(attempt.latency_ms)}</Num>
                      </td>
                      <td className="ta-right">
                        <Num w={8}>{formatTokens(attempt.tokens_used)}</Num>
                      </td>
                      <td className="ta-right">
                        <Num w={8}>{formatUsd(attempt.cost_usd)}</Num>
                      </td>
                      <td className="ta-right">
                        <Num w={5}>{formatConfidence(attempt.confidence)}</Num>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {task.result ? (
        <section className="detail__block">
          <h4 className="detail__heading">Result</h4>
          <p className="detail__summary">{task.result.summary}</p>
          <div className="detail__resultmeta">
            {task.result.classification ? (
              <span className="tag tag--type">{task.result.classification}</span>
            ) : null}
            <span className="mono">
              confidence <Num w={5}>{formatConfidence(task.result.confidence)}</Num>
            </span>
          </div>
          {findings.length > 0 ? (
            <ul className="findings">
              {findings.map((finding, index) => (
                <li key={index}>
                  <span className="findings__bullet" aria-hidden="true">
                    ▸
                  </span>
                  <span>{typeof finding === 'string' ? finding : JSON.stringify(finding)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {task.error ? (
        <section className="detail__block">
          <h4 className="detail__heading">Error</h4>
          <p className="detail__error">
            <span aria-hidden="true">✕</span> {task.error}
          </p>
        </section>
      ) : null}

      {task.status === 'PENDING' ? (
        <div className="detail__actions">
          <button type="button" className="btn" onClick={handleExecute} disabled={running}>
            Run now
          </button>
          {runError ? (
            <span className="detail__runerror" role="status">
              {runError}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
