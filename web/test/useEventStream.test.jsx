import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useEventStream } from '../src/hooks/useEventStream.js';
import { MAX_STREAM_ROWS } from '../src/lib/constants.js';
import { MockEventSource, installMockEventSource } from './mockEventSource.js';
import { AGENTS, metrics, snapshot, task } from './fixtures.js';

let restore;

beforeEach(() => {
  restore = installMockEventSource();
});

afterEach(() => {
  restore?.();
});

/** Render the hook and deliver the hydration frame, as the server always does. */
function renderHydrated(frame = snapshot()) {
  const view = renderHook(() => useEventStream());
  act(() => {
    MockEventSource.latest.open();
    MockEventSource.latest.emit('snapshot', frame);
  });
  return view;
}

describe('connection lifecycle', () => {
  it('opens exactly one stream for the whole dashboard', () => {
    renderHook(() => useEventStream());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.latest.url).toBe('/api/events');
  });

  it('starts as connecting and becomes live on open', () => {
    const { result } = renderHook(() => useEventStream());
    expect(result.current.connection).toBe('connecting');
    act(() => MockEventSource.latest.open());
    expect(result.current.connection).toBe('live');
  });

  it('reports reconnecting on a transport error rather than showing stale data as live', () => {
    const { result } = renderHydrated();
    act(() => MockEventSource.latest.fail());
    expect(result.current.connection).toBe('reconnecting');
    // The data itself is retained -- the user sees the last known state,
    // clearly labelled as not live, rather than an empty dashboard.
    expect(result.current.tasks).toHaveLength(1);
  });

  it('re-opens manually once the browser gives up (readyState CLOSED)', async () => {
    vi.useFakeTimers();
    renderHook(() => useEventStream());
    act(() => MockEventSource.latest.open());

    act(() => MockEventSource.latest.fail({ terminal: true }));
    expect(MockEventSource.instances).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not manually re-open while the browser is still retrying', () => {
    vi.useFakeTimers();
    renderHook(() => useEventStream());
    act(() => MockEventSource.latest.open());
    act(() => MockEventSource.latest.fail({ terminal: false }));

    act(() => vi.advanceTimersByTime(10000));
    expect(MockEventSource.instances).toHaveLength(1);
    vi.useRealTimers();
  });

  it('closes the stream on unmount so a remount cannot leak a connection', () => {
    const { unmount } = renderHook(() => useEventStream());
    const source = MockEventSource.latest;
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });
});

describe('snapshot hydration', () => {
  it('applies agents, tasks, metrics and config wholesale', () => {
    const { result } = renderHydrated();
    expect(result.current.agents).toHaveLength(4);
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.metrics.totals.tasks).toBe(168);
    expect(result.current.serverConfig.failure_rate).toBe(0.1);
    expect(result.current.snapshotReceived).toBe(true);
  });

  it('orders snapshot tasks newest-first regardless of server ordering', () => {
    const { result } = renderHydrated(
      snapshot({
        tasks: [
          task({ id: 'task-0001', created_at: '2026-08-15T10:00:00.000Z' }),
          task({ id: 'task-0003', created_at: '2026-08-15T12:00:00.000Z' }),
          task({ id: 'task-0002', created_at: '2026-08-15T11:00:00.000Z' }),
        ],
      })
    );
    expect(result.current.tasks.map((t) => t.id)).toEqual(['task-0003', 'task-0002', 'task-0001']);
  });

  it('caps hydration at MAX_STREAM_ROWS', () => {
    const many = Array.from({ length: MAX_STREAM_ROWS + 50 }, (_, i) =>
      task({ id: `task-${String(i).padStart(4, '0')}`, created_at: new Date(i * 1000).toISOString() })
    );
    const { result } = renderHydrated(snapshot({ tasks: many }));
    expect(result.current.tasks).toHaveLength(MAX_STREAM_ROWS);
  });

  it('re-hydrates wholesale on reconnect, which is what makes a drop self-healing', () => {
    const { result } = renderHydrated();
    act(() => MockEventSource.latest.emit('task.created', task({ id: 'task-0099' })));
    expect(result.current.tasks).toHaveLength(2);

    // A fresh snapshot replaces everything -- no merge of stale local state.
    act(() => MockEventSource.latest.emit('snapshot', snapshot({ tasks: [task({ id: 'task-0500' })] })));
    expect(result.current.tasks.map((t) => t.id)).toEqual(['task-0500']);
  });

  it('tolerates a snapshot missing its arrays', () => {
    const { result } = renderHydrated({ metrics: null });
    expect(result.current.agents).toEqual([]);
    expect(result.current.tasks).toEqual([]);
    expect(result.current.metrics).toBeNull();
  });
});

describe('task merge strategy', () => {
  it('updates an existing row IN PLACE without reordering it', () => {
    // This is the anti-jitter contract: a PROCESSING -> COMPLETED transition
    // must not make a row jump to the top under the reader's cursor.
    const { result } = renderHydrated(
      snapshot({
        tasks: [
          task({ id: 'task-0003', created_at: '2026-08-15T12:00:00.000Z' }),
          task({ id: 'task-0002', created_at: '2026-08-15T11:00:00.000Z', status: 'PROCESSING' }),
          task({ id: 'task-0001', created_at: '2026-08-15T10:00:00.000Z' }),
        ],
      })
    );

    act(() =>
      MockEventSource.latest.emit(
        'task.completed',
        task({ id: 'task-0002', created_at: '2026-08-15T11:00:00.000Z', status: 'COMPLETED' })
      )
    );

    expect(result.current.tasks.map((t) => t.id)).toEqual(['task-0003', 'task-0002', 'task-0001']);
    expect(result.current.tasks[1].status).toBe('COMPLETED');
  });

  it('prepends a genuinely new task', () => {
    const { result } = renderHydrated();
    act(() => MockEventSource.latest.emit('task.created', task({ id: 'task-0099' })));
    expect(result.current.tasks[0].id).toBe('task-0099');
    expect(result.current.tasks).toHaveLength(2);
  });

  it('merges every task event type', () => {
    const { result } = renderHydrated(snapshot({ tasks: [] }));
    const events = ['task.created', 'task.started', 'task.completed', 'task.failed', 'task.fallback'];

    events.forEach((name, i) => {
      act(() => MockEventSource.latest.emit(name, task({ id: `task-${i}` })));
    });
    expect(result.current.tasks).toHaveLength(events.length);
  });

  it('applies a fallback frame to the existing row, preserving its position', () => {
    const { result } = renderHydrated(
      snapshot({ tasks: [task({ id: 'task-0002' }), task({ id: 'task-0001' })] })
    );
    act(() =>
      MockEventSource.latest.emit(
        'task.fallback',
        task({ id: 'task-0001', fallback_applied: true, assigned_agent_name: 'General Fallback Agent' })
      )
    );

    expect(result.current.tasks.map((t) => t.id)).toEqual(['task-0002', 'task-0001']);
    expect(result.current.tasks[1].fallback_applied).toBe(true);
  });

  it('bounds the list under a sustained burst', () => {
    const { result } = renderHydrated(snapshot({ tasks: [] }));
    act(() => {
      for (let i = 0; i < MAX_STREAM_ROWS + 75; i += 1) {
        MockEventSource.latest.emit('task.created', task({ id: `task-${String(i).padStart(5, '0')}` }));
      }
    });
    expect(result.current.tasks.length).toBeLessThanOrEqual(MAX_STREAM_ROWS);
    // Newest survives, oldest is evicted.
    expect(result.current.tasks[0].id).toBe(`task-${String(MAX_STREAM_ROWS + 74).padStart(5, '0')}`);
  });

  it('ignores a task frame with no id rather than creating a phantom row', () => {
    const { result } = renderHydrated();
    act(() => MockEventSource.latest.emit('task.created', { title: 'no id' }));
    act(() => MockEventSource.latest.emit('task.created', null));
    expect(result.current.tasks).toHaveLength(1);
  });
});

describe('agent and metrics frames', () => {
  it('replaces one agent by id, leaving the others untouched', () => {
    const { result } = renderHydrated();
    act(() =>
      MockEventSource.latest.emit('agent.status', {
        ...AGENTS[0],
        status: 'PROCESSING',
        active: 2,
        capacity_label: '2/3',
      })
    );

    expect(result.current.agents).toHaveLength(4);
    const tax = result.current.agents.find((a) => a.id === 'agent-tax-01');
    expect(tax.status).toBe('PROCESSING');
    expect(tax.active).toBe(2);
    expect(result.current.agents.find((a) => a.id === 'agent-gen-00').status).toBe('IDLE');
  });

  it('preserves agent ordering when one is replaced', () => {
    const { result } = renderHydrated();
    const before = result.current.agents.map((a) => a.id);
    act(() => MockEventSource.latest.emit('agent.status', { ...AGENTS[2], status: 'ERROR' }));
    expect(result.current.agents.map((a) => a.id)).toEqual(before);
  });

  it('appends an agent id it has not seen before', () => {
    const { result } = renderHydrated();
    act(() => MockEventSource.latest.emit('agent.status', { ...AGENTS[0], id: 'agent-new-05' }));
    expect(result.current.agents).toHaveLength(5);
  });

  it('ignores an agent frame with no id', () => {
    const { result } = renderHydrated();
    act(() => MockEventSource.latest.emit('agent.status', { status: 'ERROR' }));
    expect(result.current.agents).toHaveLength(4);
  });

  it('replaces the whole metrics object', () => {
    const { result } = renderHydrated();
    act(() => MockEventSource.latest.emit('metrics.updated', metrics({ success_rate: 0.5 })));
    expect(result.current.metrics.success_rate).toBe(0.5);
  });
});

describe('resilience to malformed frames', () => {
  it('drops an unparseable frame and keeps the stream alive', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHydrated();

    act(() => MockEventSource.latest.emitRaw('task.created', '{ not json'));
    expect(warn).toHaveBeenCalled();

    // The stream still works afterwards -- one bad frame must not be fatal.
    act(() => MockEventSource.latest.emit('task.created', task({ id: 'task-0100' })));
    expect(result.current.tasks.map((t) => t.id)).toContain('task-0100');
    warn.mockRestore();
  });

  it('survives a malformed snapshot without losing the connection', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useEventStream());
    act(() => MockEventSource.latest.open());
    act(() => MockEventSource.latest.emitRaw('snapshot', 'garbage'));

    expect(result.current.snapshotReceived).toBe(false);
    act(() => MockEventSource.latest.emit('snapshot', snapshot()));
    expect(result.current.snapshotReceived).toBe(true);
    warn.mockRestore();
  });
});
