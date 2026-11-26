/** Present ranked working blockers and local Operator follow-up controls. */
import PropTypes from 'prop-types';
import {Link} from 'react-router-dom';
import {DIRECTORY} from '../data/people.js';
import {assignOwner, operatorActions, precautionaryHold, rank, requestRefresh} from '../services/decisions.js';
import {newCommandId, siteFence} from '../services/evidence.js';
import {formatDate, personName, sitePath} from '../utils/portfolio.js';

const KINDS = {blocker: 'Blocker', repair: 'Evidence repair', pending: 'Pending action', watch: 'Watch item'};

/** Render one next-best action and keep consequential alternatives as navigation. */
export function Recommendation({board, site, actor, store, readiness, notify}) {
  const ranked = rank(site, readiness);
  const proposal = site.proposal;
  const gates = operatorActions(board, site, actor);
  const active = site.lifecycle === 'open';
  const currentCandidate = ranked[0];
  const newBlocker = currentCandidate?.kind === 'blocker' && currentCandidate.row !== proposal?.targetRow ? currentCandidate : null;
  const path = `${sitePath(site.id)}?tab=approval`;
  const controls = [
    ['assign', 'Assign indicated owner', assignOwner],
    ['precautionaryHold', 'Apply precautionary hold', precautionaryHold],
    ['refresh', 'Request evidence refresh', requestRefresh],
  ];

  /** Submit only the displayed proposal and evidence row to the live guard. */
  function follow(command) {
    const result = command(store, {...siteFence(store, board, site), commandId: newCommandId(), proposalId: proposal.id, row: gates.row});
    notify(result.ok ? 'success' : 'error', result.ok ? result.data.message : result.error.message);
  }

  return (
    <section className="card space-y-4 p-4" aria-labelledby="ranked-heading">
      <h2 id="ranked-heading">Blockers and action</h2>
      <p className="meta">The assessment recommends follow-up. Field execution uses the observed evidence and required approvals.</p>
      {!ranked.some(item => item.kind === 'blocker') && (
        <p>{!active ? 'This site is not awaiting a ranked intervention.' : ranked.some(item => item.kind !== 'watch')
          ? 'No verified ranked blocker. Review the follow-up below before proceeding.'
          : 'No ranked blocker. This site can proceed on the current plan.'}</p>
      )}
      {!!ranked.length && (
        <ol className="divide-y divide-line border-y border-line" aria-label="Ranked prerequisites">
          {ranked.map(item => (
            <li key={item.row} className="grid gap-1 py-2 sm:grid-cols-2">
              <p className="font-medium">{KINDS[item.kind]} · {item.row} · {item.status} ({item.quality})</p>
              <p className="text-muted">
                {personName(board, item.ownerId)} · {(board.users[item.ownerId] ?? DIRECTORY[item.ownerId])?.phone ?? 'Phone unavailable'}
              </p>
              <p className="meta sm:col-span-2">
                Estimated resolution: {item.window ?? (item.dueDay
                  ? `Follow up by ${formatDate(item.dueDay)}${item.dueTime ? ` ${item.dueTime}` : ''}`
                  : 'Unavailable')}
              </p>
            </li>
          ))}
        </ol>
      )}
      {active && proposal && (
        <div className="space-y-2">
          <h3 className="font-semibold">Assessment recommendation</h3>
          <p className="font-medium">
            {newBlocker
              ? `Follow up on ${newBlocker.row}`
              : `${proposal.state === 'Rejected' ? 'Rejected by Priya Raman' : proposal.state} · ${proposal.impact}`}
          </p>
          <p>
            Owner: {personName(board, newBlocker?.ownerId ?? proposal.ownerId)} · Due: {formatDate(newBlocker?.dueDay ?? proposal.dueDay)}
            {!newBlocker && proposal.dueTime ? ` ${proposal.dueTime}` : ''}
          </p>
          <p className="text-muted">{newBlocker ? 'Resolve this critical-path prerequisite before relying on the current plan.' : proposal.rationaleSummary}</p>
          {currentCandidate && (
            <p className="text-muted">
              {currentCandidate.row}: {currentCandidate.status} · {currentCandidate.quality} · {site.rows[currentCandidate.row].source}.
            </p>
          )}
          {!ranked.length && <p className="text-muted">A recommendation is not permission to dispatch.</p>}
          {proposal.note && <p>{proposal.note}</p>}
          {site.holdActive && <p className="font-medium">Hold is already in effect.</p>}
          {!!(proposal.payload || proposal.alternatives.length) && (
            <ul className="space-y-2 pb-1">
              {proposal.payload?.kind === 'resequence' && (
                <li>
                  <Link className="btn" to={path}>Review in Approval</Link>
                </li>
              )}
              {proposal.alternatives.map(item => (
                <li key={item.id}>
                  <Link className="btn text-left" to={path} state={{optionId: item.id}}>{item.label}</Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            {controls.map(([key, label, run]) => (
              <div key={key}>
                <button type="button" className="btn disabled:opacity-50" disabled={!!gates[key]}
                  aria-describedby={gates[key] ? `follow-${key}` : undefined} onClick={() => follow(run)}>{label}</button>
                {gates[key] && <p className="meta mt-1" id={`follow-${key}`}>{gates[key]}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

Recommendation.propTypes = {board: PropTypes.object.isRequired, site: PropTypes.object.isRequired, actor: PropTypes.object.isRequired,
  store: PropTypes.object.isRequired, readiness: PropTypes.object.isRequired, notify: PropTypes.func.isRequired};
