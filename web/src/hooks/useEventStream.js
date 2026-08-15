import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_STREAM_ROWS } from '../lib/constants.js';

const TASK_EVENTS = [
  'task.created',
  'task.started',
  'task.completed',
  'task.failed',
  'task.fallback',
];

/** Delay before we re-open a stream the browser has given up on. */
const MANUAL_RETRY_MS = 3000;

/**
 * The single source of live truth for the dashboard.
 *
 * ONE EventSource for the whole app. Every panel reads from the state this
 * hook returns; nothing else opens a connection and nothing polls. That is
 * both a correctness property (all four regions render the same instant) and a
 * resource one (the API tracks open streams, and a dashboard that leaked one
 * per component would quietly multiply server-side listeners).
 *
 * Merge strategy:
 *  - `snapshot` is applied wholesale. It is the authoritative hydration frame
 *    and arrives again on every reconnect, which is what makes a dropped
 *    connection self-healing rather than a source of permanent drift.
 *  - task events upsert into a Map keyed by id. Existing rows are updated IN
 *    PLACE (a PROCESSING -> COMPLETED transition must not make the row jump to
 *    the top of the list); genuinely new ids are prepended.
 *  - the list is capped so a console left open overnight has bounded memory.
 */
export function useEventStream() {
  const [connection, setConnection] = useState('connecting');
  const [agents, setAgents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [serverConfig, setServerConfig] = useState(null);
  const [snapshotReceived, setSnapshotReceived] = useState(false);

  // Insertion-ordered id -> task. Held in a ref because merging must read the
  // latest map synchronously inside a native event handler, where a stale
  // state closure would silently drop concurrent updates.
  const tasksRef = useRef(new Map());

  const publish = useCallback(() => {
    setTasks(Array.from(tasksRef.current.values()));
  }, []);

  const upsertTask = useCallback(
    (task) => {
      if (!task || !task.id) return;
      const current = tasksRef.current;

      if (current.has(task.id)) {
        // Update in place: same position, new content. Mutating the existing
        // Map is safe here because we always hand React a fresh array.
        current.set(task.id, task);
      } else {
        // New task -> front of the list, then trim the tail.
        const next = new Map();
        next.set(task.id, task);
        for (const [id, existing] of current) {
          if (next.size >= MAX_STREAM_ROWS) break;
          next.set(id, existing);
        }
        tasksRef.current = next;
      }
      publish();
    },
    [publish]
  );

  useEffect(() => {
    let source = null;
    let retryTimer = null;
    let closed = false;

    const open = () => {
      if (closed) return;
      source = new EventSource('/api/events');

      source.onopen = () => setConnection('live');

      source.onerror = () => {
        if (closed) return;
        // EventSource reconnects by itself while readyState is CONNECTING. If
        // it has gone to CLOSED the browser has given up, so we re-open
        // manually. Either way the user is told "reconnecting" rather than
        // being shown stale numbers as if they were live.
        setConnection('reconnecting');
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          clearTimeout(retryTimer);
          retryTimer = setTimeout(open, MANUAL_RETRY_MS);
        }
      };

      const parse = (event, handler) => (message) => {
        try {
          handler(JSON.parse(message.data));
        } catch (err) {
          // A malformed frame must not kill the stream; drop it and continue.
          console.warn(`[stream] unparseable "${event}" frame`, err);
        }
      };

      // --- hydration -------------------------------------------------------
      source.addEventListener(
        'snapshot',
        parse('snapshot', (data) => {
          const list = Array.isArray(data.tasks) ? data.tasks : [];
          const ordered = [...list]
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
            .slice(0, MAX_STREAM_ROWS);
          tasksRef.current = new Map(ordered.map((task) => [task.id, task]));
          setTasks(ordered);
          setAgents(Array.isArray(data.agents) ? data.agents : []);
          setMetrics(data.metrics ?? null);
          setServerConfig(data.config ?? null);
          setSnapshotReceived(true);
          setConnection('live');
        })
      );

      // --- live task frames (each carries a complete task object) ----------
      for (const name of TASK_EVENTS) {
        source.addEventListener(name, parse(name, upsertTask));
      }

      // --- one agent object per frame; replace by id -----------------------
      source.addEventListener(
        'agent.status',
        parse('agent.status', (agent) => {
          if (!agent || !agent.id) return;
          setAgents((prev) => {
            const index = prev.findIndex((a) => a.id === agent.id);
            if (index === -1) return [...prev, agent];
            const next = prev.slice();
            next[index] = agent;
            return next;
          });
        })
      );

      // --- whole metrics object per frame ----------------------------------
      source.addEventListener(
        'metrics.updated',
        parse('metrics.updated', (payload) => setMetrics(payload ?? null))
      );
    };

    open();

    return () => {
      closed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [upsertTask]);

  return { connection, agents, tasks, metrics, serverConfig, snapshotReceived };
}
