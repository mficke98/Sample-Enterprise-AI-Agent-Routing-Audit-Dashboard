import { vi } from 'vitest';

/**
 * A controllable stand-in for the browser's EventSource.
 *
 * The dashboard's entire live-data path runs through one EventSource, so
 * testing the merge logic means driving frames by hand. Tests get to decide
 * exactly when a snapshot lands, when a task event arrives, and when the
 * connection drops -- none of which is possible against a real stream.
 */
export class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  /** Every instance constructed since the last reset, in order. */
  static instances = [];

  static get latest() {
    return MockEventSource.instances[MockEventSource.instances.length - 1] ?? null;
  }

  static reset() {
    MockEventSource.instances = [];
  }

  constructor(url) {
    this.url = url;
    this.readyState = MockEventSource.CONNECTING;
    this.listeners = new Map();
    this.onopen = null;
    this.onerror = null;
    this.closed = false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    const index = handlers.indexOf(handler);
    if (index !== -1) handlers.splice(index, 1);
  }

  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }

  // ---- test-facing controls ------------------------------------------------

  /** Fire `onopen`, as the browser does once headers arrive. */
  open() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.();
  }

  /** Deliver one named frame with a JSON payload. */
  emit(type, data) {
    this.emitRaw(type, JSON.stringify(data));
  }

  /** Deliver a frame with an arbitrary (possibly malformed) body. */
  emitRaw(type, raw) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ data: raw });
    }
  }

  /**
   * Simulate a transport error. `terminal: true` mimics the browser giving up
   * (readyState CLOSED), which is what triggers the hook's manual retry.
   */
  fail({ terminal = false } = {}) {
    this.readyState = terminal ? MockEventSource.CLOSED : MockEventSource.CONNECTING;
    this.onerror?.();
  }
}

/** Install the mock globally; returns a restore function. */
export function installMockEventSource() {
  MockEventSource.reset();
  const original = globalThis.EventSource;
  vi.stubGlobal('EventSource', MockEventSource);
  return () => {
    MockEventSource.reset();
    if (original) globalThis.EventSource = original;
  };
}
