/** Give the facilitator a local view of source health, scoring and workshop controls. */
import PropTypes from 'prop-types';
import {Link, useNavigate} from 'react-router-dom';
import {newCommandId} from '../services/evidence.js';
import {PORTSIDE_APPROVAL, RESTORE_TITLE, SCENARIOS, selectScenario, setFault} from '../services/sources.js';
import {formatDate} from '../utils/portfolio.js';

const badge = {Up: 'risk-green', Delayed: 'risk-amber', Down: 'risk-red'};

/** Display committed health separately from manual switch positions. */
export default function ServiceHealth({board, sources, store, notify, onRestore}) {
  const navigate = useNavigate();
  const score = board.program.lastScore;
  const assessmentDown = sources.find(row => row.sourceId === 'Assessment').state === 'Down';

  /** Commit one selected scenario and navigate only after the command succeeds. */
  function changeScenario(event) {
    const result = selectScenario(store, {scenario: event.target.value, commandId: newCommandId()});
    if (!result.ok) { notify('error', result.error.message); return; }
    notify('success', `${result.data.label} selected`);
    if (result.data.navigateTo) navigate(result.data.navigateTo);
  }

  /** Flip one manual source control without editing the other or any evidence. */
  function changeFault(source, down) {
    const result = setFault(store, {source, state: down ? 'Up' : 'Down', commandId: newCommandId()});
    if (!result.ok) { notify('error', result.error.message); return; }
    notify('success', `${source === 'Assessment' ? 'Assessment service' : source} is ${result.data.state}`);
  }

  return (
    <div className="max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-ink">Service health</h1>
          <p className="meta mt-1">Local source status and recovery for the West Metro workshop.</p>
        </div>
        <button type="button" className="btn" onClick={event => onRestore(event.currentTarget)}>{RESTORE_TITLE}…</button>
      </header>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="card p-4" aria-labelledby="source-title">
          <h2 id="source-title" className="text-base font-semibold">Sources</h2>
          <ul className="mt-2 divide-y divide-line" aria-label="Local sources">
            {sources.map(({sourceId, state, lastSyncAt, detail, scope}) => {
              const label = sourceId === 'Assessment' ? 'Assessment service' : sourceId;
              const manualDown = sourceId === 'DDL' ? board.faults.ddlOverride === 'Down' : board.faults.assessmentDown;
              const manual = sourceId === 'DDL' || sourceId === 'Assessment';
              return (
                <li key={sourceId} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                    <h3 className="font-semibold">{label}</h3>
                    <span className={`rounded-control px-2 py-0.5 text-meta font-semibold ${badge[state]}`}>{state}</span>
                  </div>
                  <p className="meta">{scope} · Last sync: {lastSyncAt ? <time dateTime={lastSyncAt}>{formatDate(lastSyncAt, true)}</time> : 'Not recorded'}</p>
                  <p>{detail}</p>
                  {manual && (
                    <button type="button" role="switch" aria-checked={manualDown} aria-label={`${label} manual outage`}
                      className="btn mt-1" onClick={() => changeFault(sourceId, manualDown)}>
                      Manual setting: {manualDown ? 'Down' : 'Up'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <div className="space-y-4">
          <section className="card space-y-3 p-4" aria-labelledby="snapshot-title">
            <h2 id="snapshot-title" className="text-base font-semibold">Snapshot</h2>
            <dl className="space-y-2">
              <div>
                <dt className="meta">Model</dt>
                <dd>{score.model}</dd>
              </div>
              <div>
                <dt className="meta">Last scored</dt>
                <dd><time dateTime={score.scoredAt}>{formatDate(score.scoredAt, true)}</time></dd>
              </div>
              <div>
                <dt className="meta">Active correlation</dt>
                <dd className="break-words font-mono">{score.correlationId}</dd>
              </div>
            </dl>
            {assessmentDown && (
              <div className="space-y-1 border-t border-line pt-3">
                <p className="font-semibold">Assessment service unavailable</p>
                <p>No new score was returned. Showing the score from {formatDate(score.scoredAt, true)}.</p>
                <Link className="font-medium text-teal-ink underline" to={`/sites/${score.siteId}?tab=prediction`}>Open last assessment</Link>
              </div>
            )}
          </section>
          <section className="card space-y-2 p-4" aria-labelledby="workshop-title">
            <h2 id="workshop-title" className="text-base font-semibold">Workshop</h2>
            <label className="block" htmlFor="workshop-scenario">Workshop scenario</label>
            <select className="field w-full" id="workshop-scenario" value={board.scenario} onChange={changeScenario}>
              {Object.entries(SCENARIOS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <p className="meta">Changing scenarios keeps working records and manual source settings.</p>
            {board.scenario === 'D' && (
              <p className="meta">
                The interruption also applies its own outages. Leave this scenario to remove them; Retry can recover assessment separately.
              </p>
            )}
            {board.scenario === 'C' && <Link className="font-medium text-teal-ink underline" to={PORTSIDE_APPROVAL}>Open Portside approval</Link>}
          </section>
        </div>
      </div>
    </div>
  );
}

ServiceHealth.propTypes = {board: PropTypes.object.isRequired, sources: PropTypes.arrayOf(PropTypes.object).isRequired,
  store: PropTypes.object.isRequired, notify: PropTypes.func.isRequired, onRestore: PropTypes.func.isRequired};
