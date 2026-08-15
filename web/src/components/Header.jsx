import { ConnectionIndicator } from './ConnectionIndicator.jsx';

/** Top bar: identity, live-stream state, and the theme switch. */
export function Header({ connection, theme, onToggleTheme }) {
  return (
    <header className="topbar">
      <div className="topbar__identity">
        <span className="topbar__mark" aria-hidden="true">
          ◆
        </span>
        <h1 className="topbar__title">Control Room</h1>
        <span className="topbar__subtitle">Agent routing &amp; audit</span>
      </div>

      <div className="topbar__tools">
        <ConnectionIndicator state={connection} />
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onToggleTheme}
          // The label states the RESULT of pressing, which is what a screen
          // reader user needs; `aria-pressed` would describe a toggle state
          // that has no obvious "on" reading here.
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          <span className="btn__text">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </header>
  );
}
