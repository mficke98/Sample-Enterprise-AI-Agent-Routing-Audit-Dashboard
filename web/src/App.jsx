import { useEffect, useRef, useState } from 'react';

import { AgentBoard } from './components/AgentBoard.jsx';
import { Header } from './components/Header.jsx';
import { MetricsPanel } from './components/MetricsPanel.jsx';
import { StreamPanel } from './components/StreamPanel.jsx';
import { TaskForm } from './components/TaskForm.jsx';
import { useCoalescedAnnouncer } from './hooks/useCoalescedAnnouncer.js';
import { useEventStream } from './hooks/useEventStream.js';
import { useMediaQuery } from './hooks/useMediaQuery.js';
import { useTheme } from './hooks/useTheme.js';

export default function App() {
  const { connection, agents, tasks, metrics } = useEventStream();
  const { theme, toggle } = useTheme();

  // The form collapses into a <details> on phones only. The open/closed state
  // lives in the DOM, so CSS alone cannot express "always open above 768px".
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [formOpen, setFormOpen] = useState(true);

  // Coalesced, polite summary for screen readers (at most one per 5s).
  const announcement = useCoalescedAnnouncer(metrics);

  // `aria-live="assertive"` interrupts whatever the user is doing. It is
  // reserved for exactly one event -- system health entering CRITICAL -- and
  // fires on the TRANSITION, not on every metrics frame that repeats it.
  const [criticalAlert, setCriticalAlert] = useState('');
  const previousHealth = useRef(null);

  useEffect(() => {
    const status = metrics?.system_health?.status ?? null;
    const before = previousHealth.current;
    previousHealth.current = status;
    if (status === 'CRITICAL' && before !== 'CRITICAL') {
      setCriticalAlert(`System health critical. ${metrics?.system_health?.reason ?? ''}`);
    } else if (status && status !== 'CRITICAL' && before === 'CRITICAL') {
      setCriticalAlert('');
    }
  }, [metrics]);

  return (
    <div className="app">
      <Header connection={connection} theme={theme} onToggleTheme={toggle} />

      <MetricsPanel metrics={metrics} />

      <AgentBoard agents={agents} />

      <details
        className="form card"
        open={!isMobile || formOpen}
        onToggle={(event) => setFormOpen(event.currentTarget.open)}
      >
        <summary className="form__summary">
          <span className="panel__title">New Task</span>
          <span className="form__chevron" aria-hidden="true" />
        </summary>
        <TaskForm />
      </details>

      <StreamPanel tasks={tasks} connection={connection} />

      {/* Live regions. Both are visually hidden; neither renders anything the
          sighted user is missing, because every state is already on screen. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive">
        {criticalAlert}
      </div>
    </div>
  );
}
