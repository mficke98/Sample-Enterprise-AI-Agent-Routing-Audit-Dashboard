import { useRef, useState } from 'react';

import { ApiError, createTask, seedSampleTasks } from '../lib/api.js';
import { KNOWN_TASK_TYPES, PRIORITIES } from '../lib/constants.js';

const EMPTY_DRAFT = { title: '', type: 'TAX', payload: '', priority: 'MEDIUM' };

/**
 * Task ingestion form.
 *
 * The interesting part is error handling. The API answers a bad submission
 * with `{ error: { code, message, details: [{field, message}] } }`, and those
 * `details` are bound to the individual inputs -- `aria-invalid` plus
 * `aria-describedby` pointing at the message -- rather than being flattened
 * into one banner. A form that says "validation failed" makes the user hunt;
 * a form that marks the field does not.
 *
 * `type` is a free-text input backed by a <datalist> rather than a <select>.
 * That is deliberate: the API accepts unknown types on purpose and routes them
 * to the GENERAL agent, so the form must let you type `LEGAL` and watch the
 * fallback path light up. A <select> would make that behaviour untestable from
 * the UI.
 */
export function TaskForm() {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef(null);

  const update = (field) => (event) => {
    const { value } = event.target;
    setDraft((current) => ({ ...current, [field]: value }));
    // Clear a field's error as soon as the user edits it; keeping a stale
    // "required" message under a now-filled box is just noise.
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const reset = () => {
    setFieldErrors({});
    setFormError(null);
    setNotice(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    reset();
    setBusy(true);
    try {
      const task = await createTask(draft);
      setDraft({ ...EMPTY_DRAFT, type: draft.type, priority: draft.priority });
      setNotice(`Queued "${task.title}" → ${task.assigned_agent_name}.`);
      titleRef.current?.focus();
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        // Only show the banner when there is something the per-field messages
        // cannot say (a 503 routing failure, a network drop).
        setFormError(err.details.length ? null : err.message);
      } else {
        setFormError('Unexpected error submitting the task.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSeed = async () => {
    reset();
    setBusy(true);
    try {
      const { count } = await seedSampleTasks();
      setNotice(`Loaded ${count} sample task${count === 1 ? '' : 's'}.`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not load sample tasks.');
    } finally {
      setBusy(false);
    }
  };

  /** Wires one control to its API-returned error message. */
  const errorProps = (field) =>
    fieldErrors[field]
      ? { 'aria-invalid': true, 'aria-describedby': `${field}-error` }
      : { 'aria-invalid': undefined };

  const FieldError = ({ field }) =>
    fieldErrors[field] ? (
      <p className="field__error" id={`${field}-error`}>
        <span aria-hidden="true">✕</span> {fieldErrors[field]}
      </p>
    ) : null;

  return (
    <form className="taskform" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="task-title">Title</label>
        <input
          id="task-title"
          name="title"
          ref={titleRef}
          type="text"
          value={draft.title}
          onChange={update('title')}
          placeholder="Q3 Corporate Tax Exemption Verification"
          autoComplete="off"
          {...errorProps('title')}
        />
        <FieldError field="title" />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="task-type">Type</label>
          <input
            id="task-type"
            name="type"
            type="text"
            list="task-type-options"
            value={draft.type}
            onChange={update('type')}
            autoComplete="off"
            spellCheck="false"
            {...errorProps('type')}
          />
          <datalist id="task-type-options">
            {KNOWN_TASK_TYPES.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
          <p className="field__hint">Unknown types route to GENERAL.</p>
          <FieldError field="type" />
        </div>

        <div className="field">
          <label htmlFor="task-priority">Priority</label>
          <select
            id="task-priority"
            name="priority"
            value={draft.priority}
            onChange={update('priority')}
            {...errorProps('priority')}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <FieldError field="priority" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="task-payload">Payload</label>
        <textarea
          id="task-payload"
          name="payload"
          rows={4}
          value={draft.payload}
          onChange={update('payload')}
          placeholder="Review Schedule C filings for high-volume transactions."
          {...errorProps('payload')}
        />
        <FieldError field="payload" />
      </div>

      {formError ? (
        <p className="banner banner--error" role="alert">
          <span aria-hidden="true">✕</span> {formError}
        </p>
      ) : null}
      {notice ? (
        <p className="banner banner--ok" role="status">
          <span aria-hidden="true">✓</span> {notice}
        </p>
      ) : null}

      <div className="taskform__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Submit task
        </button>
        <button type="button" className="btn" onClick={handleSeed} disabled={busy}>
          Load sample tasks
        </button>
      </div>
    </form>
  );
}
