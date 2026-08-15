import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { TaskRow } from './TaskRow.jsx';
import { FALLBACK_GLYPH, MAX_STREAM_ROWS } from '../lib/constants.js';

/** How far from the top counts as "the user has scrolled away". */
const FOLLOW_THRESHOLD_PX = 8;

/**
 * The live task stream.
 *
 * Scroll behaviour, which is where most live logs go wrong:
 *  - Rows are newest-first, so "following" means pinned to the TOP.
 *  - Following jumps `scrollTop` instantly. There is no smooth-scroll: an
 *    animated auto-scroll under a fast stream is a moving target that makes
 *    text unreadable and can trigger motion sickness.
 *  - The moment the user scrolls away, following stops. Yanking the viewport
 *    back while someone is reading is the single most hostile thing a log can
 *    do. A sticky "N new" button offers the jump back instead of forcing it.
 *  - `Pause stream` is separate and explicit: it freezes the rendered list
 *    outright so a row can be read and expanded while events keep arriving.
 *    Metrics and agents keep updating -- only this list is held.
 *
 * Accessibility: `role="log"` with `aria-live="off"`. Announcing every append
 * would flood a screen reader; the coalesced summary in App.jsx does that job
 * at a survivable rate.
 */
export function StreamPanel({ tasks, connection }) {
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(null);
  const [following, setFollowing] = useState(true);
  const [anchorId, setAnchorId] = useState(null);
  const [fallbackOnly, setFallbackOnly] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const scrollRef = useRef(null);

  const live = useMemo(
    () => (fallbackOnly ? tasks.filter((task) => task.fallback_applied) : tasks),
    [tasks, fallbackOnly]
  );

  // Scroll handlers fire outside React's data flow and must read the current
  // list and follow-state synchronously, so both are mirrored into refs.
  const liveRef = useRef(live);
  liveRef.current = live;
  const followingRef = useRef(following);
  followingRef.current = following;

  // While paused we render the frozen array. Because the stream hook replaces
  // task objects rather than mutating them, holding the old array holds the
  // old content too -- the freeze is real, not cosmetic.
  const visible = paused && frozen ? frozen : live;

  // Rows sitting above the anchor are what arrived since the user looked away.
  const newCount = useMemo(() => {
    if (!anchorId) return 0;
    const index = live.findIndex((task) => task.id === anchorId);
    return index > 0 ? index : 0;
  }, [anchorId, live]);

  // How many rows the pause is holding back, for the paused banner.
  const heldCount = useMemo(() => {
    if (!paused || !frozen) return 0;
    const shown = new Set(frozen.map((task) => task.id));
    return live.reduce((total, task) => total + (shown.has(task.id) ? 0 : 1), 0);
  }, [paused, frozen, live]);

  const suspendFollow = useCallback(() => {
    if (!followingRef.current) return;
    followingRef.current = false;
    setFollowing(false);
    // Remember what was on top; everything that lands above it is "new".
    setAnchorId(liveRef.current[0]?.id ?? null);
  }, []);

  const resumeFollow = useCallback(() => {
    // Guarded: `scroll` fires continuously, and re-setting identical state on
    // every event would re-render the whole list for nothing.
    if (followingRef.current) return;
    followingRef.current = true;
    setFollowing(true);
    setAnchorId(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop > FOLLOW_THRESHOLD_PX) suspendFollow();
    else resumeFollow();
  }, [suspendFollow, resumeFollow]);

  // Jump (never glide) back to the newest row whenever we are following.
  useEffect(() => {
    if (!following || paused) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [visible, following, paused]);

  const togglePause = () => {
    if (paused) {
      setPaused(false);
      setFrozen(null);
      return;
    }
    // Pause and scroll-suspension are kept as separate concerns: pausing
    // freezes WHAT is rendered, following controls WHERE the viewport sits.
    // Conflating them produced a "N new" button that scrolled to rows the
    // freeze was deliberately not showing.
    setPaused(true);
    setFrozen(live);
  };

  // Stable identity so the memoised rows are not invalidated every render.
  const toggleRow = useCallback((id) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const fallbackCount = useMemo(
    () => tasks.reduce((total, task) => total + (task.fallback_applied ? 1 : 0), 0),
    [tasks]
  );

  return (
    <section className="streamwrap" aria-label="Task stream">
      <header className="stream__head">
        <h2 className="panel__title">
          Task Stream
          <span className="panel__count mono">
            {visible.length}
            {/* The list is capped; the plus sign admits that older rows have
                been dropped rather than pretending this is the whole history. */}
            {visible.length >= MAX_STREAM_ROWS ? '+' : ''}
          </span>
        </h2>

        <div className="stream__controls">
          <button
            type="button"
            className={`btn btn--sm${fallbackOnly ? ' btn--on' : ''}`}
            onClick={() => setFallbackOnly((value) => !value)}
            aria-pressed={fallbackOnly}
            title="Show only tasks that were re-routed to the fallback agent"
          >
            <span aria-hidden="true">{FALLBACK_GLYPH}</span>
            <span className="btn__text">Fallbacks</span>
            <span className="mono">{fallbackCount}</span>
          </button>

          <button
            type="button"
            className={`btn btn--sm${paused ? ' btn--on' : ''}`}
            onClick={togglePause}
            aria-pressed={paused}
          >
            <span aria-hidden="true">{paused ? '▶' : '❙❙'}</span>
            <span className="btn__text">{paused ? 'Resume' : 'Pause'} stream</span>
          </button>
        </div>
      </header>

      {!paused && newCount > 0 ? (
        // The arrow points the way the VIEWPORT must travel. Rows are
        // newest-first, so what arrived while you were reading is above you.
        <button type="button" className="stream__new" onClick={resumeFollow}>
          <span aria-hidden="true">↑</span> {newCount} new
        </button>
      ) : null}

      {paused ? (
        <p className="stream__paused" role="status">
          Stream paused —{' '}
          {heldCount > 0
            ? `${heldCount} new row${heldCount === 1 ? '' : 's'} held`
            : 'no new rows yet'}
        </p>
      ) : null}

      <ul
        className="stream"
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="off"
        aria-label="Task events, newest first"
      >
        {visible.length === 0 ? (
          <li className="empty">
            <p className="empty__title">
              {connection === 'live' ? 'No tasks yet' : 'Waiting for the event stream…'}
            </p>
            <p className="empty__body">
              {fallbackOnly
                ? 'No task has been re-routed to the fallback agent.'
                : 'Submit a task or press “Load sample tasks” to populate the stream.'}
            </p>
          </li>
        ) : (
          visible.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              expanded={expandedId === task.id}
              onToggle={toggleRow}
            />
          ))
        )}
      </ul>
    </section>
  );
}
