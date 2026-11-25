/** Present field authority and capture an explicit confirmation for a working crew. */
import {useEffect, useRef, useState} from 'react';
import PropTypes from 'prop-types';
import {Link} from 'react-router-dom';
import {executeField, fieldConfirmation, previewField} from '../services/decisions.js';
import {newCommandId} from '../services/evidence.js';
import {authorize, INTENT} from '../utils/access.js';
import {formatDate, personName, sitePath} from '../utils/portfolio.js';

const LABELS = {dispatch: 'Dispatch crew', hold: 'Hold crew', resequence: 'Resequence'};

/** Keep the open dialog's text and command tied to the original reviewed assignment. */
export function FieldStrip({board, site, actor, store, notify}) {
  const field = previewField(board, site, actor);
  const {assignment, option, holdReason, held, reasons, approvals} = field;
  const [pending, setPending] = useState(null);
  const dialog = useRef(null);
  const trigger = useRef(null);
  const heading = useRef(null);

  useEffect(() => {
    if (pending && !dialog.current.open) dialog.current.showModal();
  }, [pending]);

  /** Freeze the exact details presented for execution, not only the action name. */
  function open(action, event) {
    const input = fieldConfirmation(store, board, site, field, action);
    if (!input) return;
    const day = formatDate(assignment.shiftAt.slice(0, 10));
    const shift = `${day} at ${assignment.shiftAt.slice(11, 16)}`;
    const lead = personName(board, assignment.leadId);
    const scope = approvals.resequence?.scope;
    const message = action === 'dispatch' ? `Dispatch ${lead}’s crew of ${assignment.size} to ${site.name} on ${shift}. This does not change the supplier or the baseline date.`
      : action === 'hold' ? `Hold ${lead}’s crew of ${assignment.size} for ${site.name} on ${shift}. The crew, shift, supplier and baseline date stay unchanged.`
        : `Record the approved crew slot for ${site.name}: ${personName(board, scope.crewLeadId)}, crew of ${scope.crewSize}, ${formatDate(scope.shiftAt, true)}. This does not dispatch the crew or change the baseline date.`;
    trigger.current = event.currentTarget;
    setPending({input: {...input, commandId: newCommandId()}, message});
  }

  /** Clear the review and restore focus even if the confirmed control became disabled. */
  function closed() {
    setPending(null);
    const control = trigger.current;
    (control && !control.disabled ? control : heading.current)?.focus();
  }

  /** Commit only the captured review; never silently replace a stale confirmation. */
  function confirm() {
    const result = executeField(store, pending.input);
    dialog.current.close();
    notify(result.ok ? 'success' : 'error', result.ok ? result.data.message : result.error.message);
  }

  return (
    <section className="card space-y-3 p-4" aria-labelledby="field-heading">
      <h2 id="field-heading" ref={heading} tabIndex={-1}>Field execution</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="meta">Crew lead</dt>
          <dd>{assignment ? personName(board, assignment.leadId) : 'Unconfirmed'}</dd>
        </div>
        <div>
          <dt className="meta">Crew size</dt>
          <dd>{assignment?.size ?? 'Unconfirmed'}</dd>
        </div>
        <div>
          <dt className="meta">Depot</dt>
          <dd>{assignment?.depot ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt className="meta">Planned shift</dt>
          <dd>{assignment?.shiftAt ? formatDate(assignment.shiftAt, true) : 'Unconfirmed'}</dd>
        </div>
      </dl>
      {assignment && <p className="font-medium">Crew status: {assignment.state}</p>}
      {holdReason && <p id="field-hold-reason">{holdReason}</p>}
      {approvals.dispatch && <p className="meta">Dispatch approved by Priya Raman · {formatDate(approvals.dispatch.at, true)}</p>}
      <div className="flex flex-wrap gap-3">
        {Object.entries(LABELS).map(([action, label]) => {
          const reason = reasons[action];
          const reasonId = reason === holdReason ? 'field-hold-reason' : `field-${action}-reason`;
          return (
            <div key={action}>
              <button type="button" className={`btn disabled:opacity-50 ${action === 'dispatch' ? 'btn-primary' : ''}`}
                disabled={!!reason} aria-pressed={action === 'hold' ? held : undefined}
                aria-describedby={reason ? reasonId : undefined} onClick={event => open(action, event)}>{label}</button>
              {reason && reason !== holdReason && <p id={reasonId} className="meta mt-1 max-w-xs">{reason}</p>}
            </div>
          );
        })}
      </div>
      {option && (
        <div className="space-y-1 border-t border-line pt-3">
          <h3 className="font-semibold">North Gate spare crew · 21 May</h3>
          <p className="text-muted">This spare slot is separate from the active assignment.</p>
          {authorize(actor, INTENT.resequence) && (
            <Link className="font-medium text-teal-ink underline" to={`${sitePath(site.id)}?tab=approval`} state={{optionId: option.id}}>Review resequence in Approval</Link>
          )}
        </div>
      )}
      <dialog ref={dialog} aria-modal="true" aria-labelledby="field-confirm" aria-describedby="field-confirm-copy"
        onClose={closed} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}
        className="card w-11/12 max-w-lg p-0 text-ink">
        {pending && (
          <div className="space-y-3 p-5">
            <h3 id="field-confirm">Confirm {LABELS[pending.input.action].toLowerCase()}</h3>
            <p id="field-confirm-copy">{pending.message}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => dialog.current.close()}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirm}>Confirm</button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}

FieldStrip.propTypes = {board: PropTypes.object.isRequired, site: PropTypes.object.isRequired, actor: PropTypes.object.isRequired,
  store: PropTypes.object.isRequired, notify: PropTypes.func.isRequired};
