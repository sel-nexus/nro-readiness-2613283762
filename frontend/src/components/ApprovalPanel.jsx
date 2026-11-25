/** Review an exact consequential payload and distinguish approval from a denied attempt. */
import {useState} from 'react';
import PropTypes from 'prop-types';
import {DIRECTORY} from '../data/people.js';
import {BOARD_AT, SUPPLIERS} from '../data/register.js';
import {approvalDenialReason, decide, previewApproval, recordApprovalDenial} from '../services/decisions.js';
import {newCommandId, siteFence} from '../services/evidence.js';
import {authorize, INTENT} from '../utils/access.js';
import {formatDate, personName} from '../utils/portfolio.js';

const LABELS = {approve: 'Approve', reject: 'Reject', modify: 'Modify', override: 'Override'};

/** Render reviewed plan fields without exposing commercial values. */
function PlanValues({heading, plan}) {
  return (
    <div className="space-y-1 border-l-2 border-line pl-3">
      <h3 className="font-semibold">{heading}</h3>
      <p>{SUPPLIERS[plan.supplierId].name}</p>
      <p>{plan.agreementId}</p>
      <p>{formatDate(plan.plannedDay)}</p>
    </div>
  );
}

PlanValues.propTypes = {heading: PropTypes.string.isRequired, plan: PropTypes.object.isRequired};

/** Bind draft rationale to the mounted, revision-keyed review supplied by the workspace. */
export function ApprovalPanel({board, site, actor, store, readiness, notify, optionId}) {
  const review = previewApproval(site, optionId);
  const [rationale, setRationale] = useState('');
  const [modifying, setModifying] = useState(false);
  const [ownerId, setOwnerId] = useState(site.proposal?.ownerId ?? '');
  const [dueDay, setDueDay] = useState(site.proposal?.dueDay ?? '');
  const [note, setNote] = useState('');
  const [confidenceReviewed, setConfidenceReviewed] = useState(false);
  const [error, setError] = useState(null);
  const canDecide = authorize(actor, INTENT.approve);
  const needsReview = readiness.reviewRequired || readiness.confidence == null;
  const denial = canDecide ? null : approvalDenialReason(actor);
  const reviewedAssignmentRev = board.program.crew.find(item => item.id === review.scope?.assignmentId && item.siteId === site.id)?.rev ?? null;

  /** Record a decision or invoke the separate rationale-free denial path. */
  function submit(verb) {
    const input = {...siteFence(store, board, site), commandId: newCommandId(), proposalId: review.proposalId, optionId};
    const result = canDecide
      ? decide(store, {...input, verb, reviewKey: review.reviewKey, expectedFaultRev: board.faults.rev, reviewedAssignmentRev,
        rationale, ownerId, dueDay, note, confidenceReviewed})
      : recordApprovalDenial(store, {...input, attempt: verb});
    setError(result.ok ? null : result.error);
    if (result.ok || !canDecide) notify(result.ok ? 'success' : 'error', result.ok ? result.data.message : result.error.message);
  }

  return (
    <section className="card space-y-4 p-4" aria-labelledby="approval-heading">
      <h2 id="approval-heading">Approval</h2>
      {!review.validOption && <p role="status">This option does not belong to this site. Open a current option from Blockers and action.</p>}
      {review.label && <p className="font-medium">{review.label}</p>}
      {review.label && !review.scope && <p>No supplier payload is on file. Priya can review the escalation, but no change can be applied here.</p>}
      {review.scope && (review.eligible || !site.decisions.length) && (
        <>
          <p>Approver: Priya Raman · {site.proposal.state}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <PlanValues heading="Before" plan={review.before} />
            <PlanValues heading="After (proposed)" plan={review.after} />
          </div>
          <p className="meta">Commercial terms on file.</p>
          <p>{review.scope.kind === 'hold' ? 'Hold the work; keep the supplier, baseline date and crew assignment.'
            : 'A plan change does not authorize dispatch or move the working crew.'}</p>
          {review.scope.shiftAt && (
            <p>
              Proposed crew slot: {personName(board, review.scope.crewLeadId)} · Crew of {review.scope.crewSize}
              {' · '}{formatDate(review.scope.shiftAt, true)}
            </p>
          )}
        </>
      )}
      {!review.scope && !site.decisions.length && !review.label && review.validOption && <p>No approval is recorded.</p>}
      {review.eligible && (
        <div className="space-y-3">
          {!canDecide && <p id="approval-denied-reason">{denial}</p>}
          {canDecide && (
            <div className="grid max-w-xl gap-2">
              <label className="font-medium" htmlFor="decision-reason">Why is this the right call for the cluster?</label>
              <textarea id="decision-reason" className="field" rows={3} value={rationale}
                aria-required="true" aria-invalid={error?.code === 'BAD_RATIONALE'}
                aria-describedby={error?.code === 'BAD_RATIONALE' ? 'reason-hint decision-error' : 'reason-hint'}
                onChange={event => setRationale(event.target.value)} />
              <p id="reason-hint" className="meta">12–1000 characters, excluding leading and trailing whitespace.</p>
              {needsReview && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={confidenceReviewed} onChange={event => setConfidenceReviewed(event.target.checked)} />
                  I reviewed the evidence and the {readiness.confidence == null ? 'unknown' : `${readiness.confidence}%`} confidence.
                </label>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {Object.entries(LABELS).map(([verb, label]) => (
              <button key={verb} type="button" className={`btn disabled:opacity-50 ${verb === 'approve' ? 'btn-primary' : ''}`}
                disabled={!canDecide} aria-describedby={denial ? 'approval-denied-reason' : undefined}
                aria-expanded={verb === 'modify' ? modifying : undefined}
                onClick={() => verb === 'modify' ? setModifying(!modifying) : submit(verb)}>
                {label}
              </button>
            ))}
          </div>
          {!canDecide && (
            <button className="btn" type="button" aria-describedby="approval-denied-reason" onClick={() => submit('approve')}>
              Record denied approval attempt
            </button>
          )}
          {canDecide && modifying && (
            <fieldset className="grid max-w-xl gap-2 border-t border-line pt-2"
              aria-describedby={error?.code === 'BAD_MODIFICATION' ? 'decision-error' : undefined}>
              <legend className="font-medium">Modify follow-up</legend>
              <label htmlFor="modified-owner">Owner</label>
              <select id="modified-owner" className="field" aria-required="true" value={ownerId} onChange={event => setOwnerId(event.target.value)}>
                <option value="">Choose owner</option>
                {[...Object.values(board.users), ...Object.values(DIRECTORY)].map(person => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
              <label htmlFor="modified-due">Due date</label>
              <input id="modified-due" className="field" aria-required="true" type="date" min={BOARD_AT.slice(0, 10)}
                value={dueDay} onChange={event => setDueDay(event.target.value)} />
              <label htmlFor="modified-note">Short note</label>
              <textarea id="modified-note" className="field" aria-required="true" aria-describedby="modified-note-hint"
                rows={2} value={note} onChange={event => setNote(event.target.value)} />
              <p id="modified-note-hint" className="meta">Up to 1000 characters, excluding leading and trailing whitespace.</p>
              <button className="btn justify-self-start" type="button" onClick={() => submit('modify')}>Save modification</button>
            </fieldset>
          )}
          {canDecide && error && <p role="alert" id="decision-error" className="text-red">{error.message}</p>}
        </div>
      )}
      {site.decisions.map(decision => (
        <article key={decision.id} id={decision.id} tabIndex={-1} className="space-y-2 border-t border-line pt-3">
          <h3 className="font-semibold">{decision.verb === 'reject' ? 'Rejected by Priya Raman' : decision.disposition ?? 'Approved dispatch'}</h3>
          <p className="meta">
            {personName(board, decision.actorId)} · {formatDate(decision.at, true)} · {LABELS[decision.verb]}
            {decision.workflowId ? ` · ${decision.workflowId} queued locally` : ''}
          </p>
          <p className="break-words">{decision.rationale}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <PlanValues heading="Before decision" plan={decision.before} />
            <PlanValues heading="After decision" plan={decision.after} />
          </div>
          {decision.note && <p>{personName(board, decision.ownerId)} · {formatDate(decision.dueDay)} · {decision.note}</p>}
        </article>
      ))}
    </section>
  );
}

ApprovalPanel.propTypes = {board: PropTypes.object.isRequired, site: PropTypes.object.isRequired, actor: PropTypes.object.isRequired,
  store: PropTypes.object.isRequired, readiness: PropTypes.object.isRequired, notify: PropTypes.func.isRequired, optionId: PropTypes.string};
