/** Give the facilitator a local view of source health, scoring and workshop controls. */
import PropTypes from 'prop-types';
import {Link, useNavigate} from 'react-router-dom';
import {ROW_ORDER} from '../data/register.js';
import {SCORING_DELAY} from '../services/assessment.js';
import {newCommandId} from '../services/evidence.js';
import {PORTSIDE_APPROVAL, RESTORE_TITLE, SCENARIOS, selectScenario, setFault} from '../services/sources.js';
import {formatDate} from '../utils/portfolio.js';
import {DEFAULT_THRESHOLDS} from '../utils/readiness.js';

const badge = {Up: 'risk-green', Delayed: 'risk-amber', Down: 'risk-red'};
const scoreFields = {goodProbability: 'Good probability (%)', goodConfidence: 'Good confidence (%)',
  attentionFrom: 'Needs Attention minimum (%)', dispatchBelow: 'Dispatch minimum confidence (%)'};

/** Render scoped settings as a draft until the facilitator explicitly saves. */
function ThresholdForm({thresholds, onSave}) {
  /** Parse validated native number inputs without changing the committed score. */
  function submit(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    onSave({...Object.fromEntries(Object.keys(scoreFields).map(key => [key, Number(fields.get(key))])),
      freshness: Object.fromEntries(ROW_ORDER.map(key => [key, Number(fields.get(key))]))});
  }

  return (
    <section className="card space-y-3 p-4" aria-labelledby="threshold-title">
      <h2 id="threshold-title" className="text-base font-semibold">Thresholds</h2>
      <p className="meta">Changes update labels and dispatch checks for this program without running a new assessment.</p>
      <form className="space-y-4" onSubmit={submit}>
        <fieldset className="space-y-2">
          <legend className="font-medium">Readiness and dispatch</legend>
          <p className="meta">Critical is below the Needs Attention minimum. Approval cannot bypass a dispatch block or a failed prerequisite.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(scoreFields).map(([key, label]) => (
              <label key={key} className="block space-y-1">
                <span className="block">{label}</span>
                <input className="field w-full" type="number" name={key} min="0" max="100" step="1" required defaultValue={thresholds[key]} />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="font-medium">Evidence freshness</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ROW_ORDER.map(key => (
              <label key={key} className="block space-y-1">
                <span className="block">{key} freshness (days)</span>
                <input className="field w-full" type="number" name={key} min="0" step="1" required defaultValue={thresholds.freshness[key]} />
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="btn btn-primary">Save thresholds</button>
      </form>
    </section>
  );
}

ThresholdForm.propTypes = {thresholds: PropTypes.object.isRequired, onSave: PropTypes.func.isRequired};

/** Display committed health separately from manual switch positions. */
export default function ServiceHealth({board, sources, store, notify, onRestore}) {
  const navigate = useNavigate();
  const score = board.program.lastScore;
  const assessmentStatus = sources.find(row => row.sourceId === 'Assessment').state;
  const assessmentDown = assessmentStatus === 'Down';

  /** Save settings only after the storage command authorizes this session. */
  function saveThresholds(thresholds) {
    const result = store.saveThresholds(thresholds, newCommandId());
    if (!result.ok) { notify('error', result.error.message); return; }
    notify('success', 'Thresholds saved. No new assessment was run.');
  }

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
    <div className="min-w-0 max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-ink">Service health</h1>
          <p className="meta mt-1">Local source status and workshop controls for {board.program.cluster}.</p>
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
                <dt className="meta">Model version</dt>
                <dd>{score.model}</dd>
              </div>
              <div>
                <dt className="meta">Last scored</dt>
                <dd><time dateTime={score.scoredAt}>{formatDate(score.scoredAt, true)}</time></dd>
              </div>
              <div>
                <dt className="meta">Correlation ID</dt>
                <dd className="break-words font-mono">{score.correlationId}</dd>
              </div>
              <div>
                <dt className="meta">Assessment source status</dt>
                <dd>{assessmentStatus}</dd>
              </div>
              <div>
                <dt className="meta">Assessment latency</dt>
                <dd>{SCORING_DELAY} ms (simulated)</dd>
              </div>
            </dl>
            {assessmentDown && (
              <div className="space-y-1 border-t border-line pt-3">
                <p className="font-semibold">Assessment service unavailable</p>
                <p>No new score was returned. Showing the score from {formatDate(score.scoredAt, true)}.</p>
                <Link className="btn" to={`/sites/${score.siteId}?tab=prediction`}>Open last assessment</Link>
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
            {board.scenario === 'C' && <Link className="btn" to={PORTSIDE_APPROVAL}>Open Portside approval</Link>}
          </section>
        </div>
      </div>
      <ThresholdForm thresholds={board.program.thresholds ?? DEFAULT_THRESHOLDS} onSave={saveThresholds} />
    </div>
  );
}

ServiceHealth.propTypes = {board: PropTypes.object.isRequired, sources: PropTypes.arrayOf(PropTypes.object).isRequired,
  store: PropTypes.object.isRequired, notify: PropTypes.func.isRequired, onRestore: PropTypes.func.isRequired};
