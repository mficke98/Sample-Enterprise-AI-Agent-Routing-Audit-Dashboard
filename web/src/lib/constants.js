/**
 * State vocabulary.
 *
 * Every state in this dashboard is encoded THREE ways: a glyph, a word, and a
 * colour. Colour is always the least significant of the three -- it is the one
 * that disappears in grayscale, under colour-vision deficiency, and on a
 * projector. Keeping the glyph/label pairs in one table is what makes that
 * discipline enforceable rather than aspirational.
 */

export const AGENT_STATUS_META = {
  IDLE: { glyph: '○', label: 'IDLE', tone: 'idle' }, //  ○
  PROCESSING: { glyph: '◐', label: 'PROCESSING', tone: 'processing' }, //  ◐
  ERROR: { glyph: '✕', label: 'ERROR', tone: 'error' }, //  ✕
};

export const TASK_STATUS_META = {
  PENDING: { glyph: '·', label: 'PENDING', tone: 'idle' }, //  ·
  PROCESSING: { glyph: '◐', label: 'PROCESSING', tone: 'processing' }, //  ◐
  COMPLETED: { glyph: '✓', label: 'COMPLETED', tone: 'success' }, //  ✓
  FAILED: { glyph: '✕', label: 'FAILED', tone: 'error' }, //  ✕
};

export const PRIORITY_META = {
  HIGH: { glyph: '▲▲▲', label: 'HIGH' }, //  ▲▲▲
  MEDIUM: { glyph: '▲▲', label: 'MEDIUM' }, //  ▲▲
  LOW: { glyph: '▲', label: 'LOW' }, //  ▲
};

export const OUTCOME_META = {
  SUCCESS: { glyph: '✓', label: 'SUCCESS', tone: 'success' }, //  ✓
  ERROR: { glyph: '✕', label: 'ERROR', tone: 'error' }, //  ✕
  TIMEOUT: { glyph: '⧖', label: 'TIMEOUT', tone: 'error' }, //  ⧖
};

export const HEALTH_META = {
  HEALTHY: { glyph: '✓', label: 'HEALTHY', tone: 'success' }, //  ✓
  DEGRADED: { glyph: '△', label: 'DEGRADED', tone: 'warn' }, //  △
  CRITICAL: { glyph: '✕', label: 'CRITICAL', tone: 'error' }, //  ✕
};

export const FALLBACK_GLYPH = '↩'; //  ↩
export const ROUTE_ARROW = '⟶'; //  ⟶

/** Types the configured agent roster can serve directly. */
export const KNOWN_TASK_TYPES = ['TAX', 'AUDIT', 'SECURITY', 'GENERAL'];

export const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];

/** Hard cap on rendered stream rows -- bounds memory on a long-lived console. */
export const MAX_STREAM_ROWS = 200;

/** Fallback metadata for a state the API might add later. */
export const UNKNOWN_META = { glyph: '?', label: 'UNKNOWN', tone: 'idle' };

export const metaFor = (table, key) => table[key] ?? { ...UNKNOWN_META, label: key || 'UNKNOWN' };
