/** Confirm a board-only restore without writing on dismissal. */
import {useLayoutEffect, useRef, useState} from 'react';
import PropTypes from 'prop-types';
import {newCommandId} from '../services/evidence.js';
import {RESTORE_TITLE, restoreMorning} from '../services/sources.js';

/** Keep focus in the native modal and confirm only the session and generation captured on open. */
export function RestoreDialog({store, intent, onDismiss, onRestored}) {
  const dialog = useRef(null);
  const cancel = useRef(null);
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    const element = dialog.current;
    element.showModal();
    cancel.current.focus();
    return () => {
      if (element.open) element.close();
    };
  }, []);

  /** Close the native surface before returning focus to the actual opening control. */
  function dismiss() {
    dialog.current.close();
    onDismiss();
  }

  /** Publish success only after the board and journal have been fully committed. */
  function confirm() {
    const result = restoreMorning(store, {...intent, commandId: newCommandId(), confirmed: true, allPrograms: true});
    if (!result.ok) { setError(result.error.message); return; }
    dismiss();
    onRestored();
  }

  return (
    <dialog ref={dialog} aria-modal="true" aria-labelledby="restore-title" aria-describedby="restore-description"
      className="card w-[min(28rem,calc(100%-2rem))] max-w-none p-0 text-ink shadow-sm"
      onCancel={event => { event.preventDefault(); dismiss(); }}
      onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
      <div className="space-y-4 p-5">
        <h2 id="restore-title" className="text-base font-semibold">{RESTORE_TITLE}</h2>
        <p id="restore-description">Restores all programs to their morning records, including the 09:40 West Metro snapshot. Working changes, files, scenarios and thresholds are reset. You stay signed in.</p>
        {error && <p role="alert" className="text-red">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={cancel} type="button" className="btn" onClick={dismiss}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={confirm}>{RESTORE_TITLE}</button>
        </div>
      </div>
    </dialog>
  );
}

RestoreDialog.propTypes = {store: PropTypes.object.isRequired, intent: PropTypes.object.isRequired,
  onDismiss: PropTypes.func.isRequired, onRestored: PropTypes.func.isRequired};
