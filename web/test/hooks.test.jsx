import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useCoalescedAnnouncer } from '../src/hooks/useCoalescedAnnouncer.js';
import { useMediaQuery } from '../src/hooks/useMediaQuery.js';
import { useTheme } from '../src/hooks/useTheme.js';
import { metrics } from './fixtures.js';

describe('useTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    window.localStorage?.clear?.();
  });

  it('defaults to dark, matching the pre-paint decision in index.html', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('trusts the attribute already on the document over anything else', () => {
    // The inline script resolves the theme before first paint; React must not
    // disagree with it and cause a flash.
    document.documentElement.setAttribute('data-theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('writes the choice to the document root', () => {
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => result.current.toggle());
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggles back and forth', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
  });

  it('persists the choice', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(setItem).toHaveBeenCalledWith('control-room:theme', 'light');
  });

  it('still works when storage throws (private browsing)', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => useTheme());
    // The choice simply does not persist; it must not crash the dashboard.
    expect(() => act(() => result.current.toggle())).not.toThrow();
    expect(result.current.theme).toBe('light');
  });

  it('keeps a stable toggle identity across renders', () => {
    const { result, rerender } = renderHook(() => useTheme());
    const first = result.current.toggle;
    rerender();
    expect(result.current.toggle).toBe(first);
  });
});

describe('useMediaQuery', () => {
  /** Install a controllable matchMedia and return a fire() to flip it. */
  function stubMatchMedia(initial = false) {
    const listeners = new Set();
    const list = {
      matches: initial,
      addEventListener: (_, cb) => listeners.add(cb),
      removeEventListener: (_, cb) => listeners.delete(cb),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => list));
    return {
      list,
      fire(matches) {
        list.matches = matches;
        listeners.forEach((cb) => cb({ matches }));
      },
      get listenerCount() {
        return listeners.size;
      },
    };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('reports the initial match synchronously, before any effect runs', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(true);
  });

  it('updates when the viewport crosses the breakpoint', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);

    act(() => media.fire(true));
    expect(result.current).toBe(true);
  });

  it('removes its listener on unmount', () => {
    const media = stubMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(media.listenerCount).toBe(1);
    unmount();
    expect(media.listenerCount).toBe(0);
  });

  it('re-subscribes when the query itself changes', () => {
    const media = stubMatchMedia(false);
    const { rerender } = renderHook(({ q }) => useMediaQuery(q), {
      initialProps: { q: '(max-width: 767px)' },
    });
    rerender({ q: '(min-width: 1200px)' });
    expect(media.listenerCount).toBe(1);
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1200px)');
  });
});

describe('useCoalescedAnnouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const withTotals = (over) =>
    metrics({
      totals: { tasks: 10, pending: 1, processing: 2, completed: 5, failed: 0, terminal: 5, ...over.totals },
      fallback: { count: over.fallbacks ?? 0, rate: 0, label: 'x' },
    });

  it('says nothing before a baseline has been established', () => {
    const { result } = renderHook(() => useCoalescedAnnouncer(withTotals({})));
    act(() => vi.advanceTimersByTime(5000));
    // The first sample only records the baseline; announcing it would restate
    // the whole world rather than describe a change.
    expect(result.current).toBe('');
  });

  it('announces the DELTA once a change has occurred', () => {
    const { result, rerender } = renderHook(({ m }) => useCoalescedAnnouncer(m), {
      initialProps: { m: withTotals({}) },
    });

    act(() => vi.advanceTimersByTime(5000)); // baseline
    rerender({ m: withTotals({ totals: { completed: 8, failed: 1 } }) });
    act(() => vi.advanceTimersByTime(5000));

    expect(result.current).toMatch(/3 completed/);
    expect(result.current).toMatch(/1 failed/);
  });

  it('names re-routed tasks specifically, since that is the feature under watch', () => {
    const { result, rerender } = renderHook(({ m }) => useCoalescedAnnouncer(m), {
      initialProps: { m: withTotals({ fallbacks: 0 }) },
    });

    act(() => vi.advanceTimersByTime(5000));
    rerender({ m: withTotals({ fallbacks: 2 }) });
    act(() => vi.advanceTimersByTime(5000));

    expect(result.current).toMatch(/2 re-routed to fallback/);
  });

  it('includes the current in-flight picture alongside the delta', () => {
    const { result, rerender } = renderHook(({ m }) => useCoalescedAnnouncer(m), {
      initialProps: { m: withTotals({}) },
    });
    act(() => vi.advanceTimersByTime(5000));
    rerender({ m: withTotals({ totals: { completed: 6 } }) });
    act(() => vi.advanceTimersByTime(5000));

    expect(result.current).toMatch(/processing/);
    expect(result.current).toMatch(/pending/);
  });

  it('stays silent when nothing changed, rather than repeating itself', () => {
    const constant = withTotals({});
    const { result, rerender } = renderHook(({ m }) => useCoalescedAnnouncer(m), {
      initialProps: { m: constant },
    });

    act(() => vi.advanceTimersByTime(5000));
    rerender({ m: constant });
    act(() => vi.advanceTimersByTime(15000));
    expect(result.current).toBe('');
  });

  it('announces at most once per 5s no matter how fast frames arrive', () => {
    const { result, rerender } = renderHook(({ m }) => useCoalescedAnnouncer(m), {
      initialProps: { m: withTotals({}) },
    });
    act(() => vi.advanceTimersByTime(5000)); // baseline at completed = 5

    // 50 frames spread across exactly one 5s window (50 x 100ms). They must
    // coalesce into ONE utterance describing the whole delta, not 50 of them.
    for (let i = 1; i <= 50; i += 1) {
      rerender({ m: withTotals({ totals: { completed: 5 + i } }) });
      act(() => vi.advanceTimersByTime(100));
    }

    // 5 -> 55 across the window, reported once as a single summed delta.
    expect(result.current).toMatch(/50 completed/);
  });

  it('alternates trailing whitespace so an identical message is not swallowed', () => {
    const { result, rerender } = renderHook(({ m }) => useCoalescedAnnouncer(m), {
      initialProps: { m: withTotals({}) },
    });
    act(() => vi.advanceTimersByTime(5000));

    rerender({ m: withTotals({ totals: { completed: 6 } }) });
    act(() => vi.advanceTimersByTime(5000));
    const first = result.current;

    rerender({ m: withTotals({ totals: { completed: 7 } }) });
    act(() => vi.advanceTimersByTime(5000));
    const second = result.current;

    // Same semantic content ("1 completed"), but the strings must differ or a
    // live region treats the second as "no change" and stays silent.
    expect(first.trim()).toBe(second.trim());
    expect(first).not.toBe(second);
  });

  it('ignores null metrics without throwing', () => {
    const { result } = renderHook(() => useCoalescedAnnouncer(null));
    expect(() => act(() => vi.advanceTimersByTime(15000))).not.toThrow();
    expect(result.current).toBe('');
  });

  it('clears its interval on unmount', () => {
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useCoalescedAnnouncer(metrics()));
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});
