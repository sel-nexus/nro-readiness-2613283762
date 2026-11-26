/** Explain the recorded forecast and run deterministic local replays on demand. */
import {useLayoutEffect, useRef, useState} from 'react';
import PropTypes from 'prop-types';
import {Link} from 'react-router-dom';
import {keepLastScore, runAssessment, UNSUPPORTED_REPLAY} from '../services/assessment.js';
import {newCommandId} from '../services/evidence.js';
import {authorize, INTENT} from '../utils/access.js';
import {formatDate, sitePath} from '../utils/portfolio.js';
import {assessmentIsDown, civilMillis, confidenceBand, RESCORE_NOTICE} from '../utils/readiness.js';

/** Link an explanation to the actual evidence, plan or approval it describes. */
function factorLink(site, factor) {
  const path = sitePath(site.id);
  switch (factor.targetKind) {
    case 'row': return `${path}?tab=evidence#evidence-${factor.targetRef}`;
    case 'document': return `${path}?tab=evidence#${factor.targetRef}`;
    case 'plan': return `${path}?tab=prediction#site-plan`;
    case 'approval': return `${path}?tab=approval#${factor.targetRef}`;
    case 'history': return `${path}?tab=audit`;
    default: return `${path}?tab=evidence#evidence-matrix`;
  }
}

/** Measure the recorded lead time in calendar days, not the eligibility window. */
function recordedHorizon(score) {
  if (!score?.plannedDay || !score.scoredAt) return null;
  const days = (civilMillis(`${score.plannedDay}T00:00:00`) - civilMillis(`${score.scoredAt.slice(0, 10)}T00:00:00`)) / 86400000;
  return Number.isFinite(days) && days >= 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : null;
}

/** Add linked factual context when the fixture supplies fewer than three signed factors. */
function contextFor(site, factors) {
  const base = `${sitePath(site.id)}?tab=`;
  const context = [
    [site.plan.plannedDay ? `Recorded plan: ${formatDate(site.plan.plannedDay)}.` : 'No upcoming installation date.', `${base}prediction#site-plan`],
    ['Review the working evidence and source timestamps.', `${base}evidence`],
    ['Review recorded score history.', `${base}audit`],
  ];
  if (site.assessment?.factorNote) context.unshift([site.assessment.factorNote, `${base}audit`]);
  return context.slice(0, Math.max(0, 3 - factors.length));
}

/** Render retained and current scores distinctly, with accessible asynchronous feedback. */
export function PredictionPanel({board, site, actor, store, readiness}) {
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const active = useRef(null);
  useLayoutEffect(() => () => active.current?.abort(), []);
  const {lastScore, current, horizonEligible} = readiness;
  const isHarbor = site.id === 'NRO-W-1842';
  const closed = site.lifecycle === 'on_air';
  const dispatched = site.lifecycle === 'dispatched';
  const historical = !current || dispatched;
  const outage = horizonEligible && (assessmentIsDown(board.faults) || site.scoreState === 'retained_outage');
  const canRun = horizonEligible && authorize(actor, INTENT.assess);
  const canRetry = horizonEligible && authorize(actor, INTENT.retry);
  const factors = lastScore?.contributions ?? [];
  const scale = Math.max(1, ...factors.map(factor => Math.abs(factor.points)));
  const closeResult = closed && board.audit.events.find(event => event.verb === 'Scored' && event.snapshotId === lastScore?.snapshotId);
  const value = closed ? closeResult?.output : lastScore?.probability;
  const horizon = recordedHorizon(lastScore);
  const clockTime = lastScore?.scoredAt.slice(11, lastScore.scoredAt.endsWith(':00') ? 16 : 19);
  const priorTime = lastScore && `${formatDate(lastScore.scoredAt)}, ${clockTime}`;

  /** Start one page attempt and ignore completion after its pane unmounts. */
  async function run(mode) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setDismissed(false);
    setError('');
    setAnnouncement('Scoring…');
    try {
      const result = await runAssessment(store, {siteId: site.id, expectedSiteRev: site.rev, mode, commandId: newCommandId(), signal: controller.signal});
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setError(result.error.message);
        setAnnouncement('');
      } else {
        const message = {retained_outage: 'Assessment service unavailable. No new score was returned.', unsupported: UNSUPPORTED_REPLAY,
          inapplicable: 'No new forecast applies to this site.', unavailable: 'Assessment complete. Probability is Unavailable.'};
        setAnnouncement(message[result.data.state] ?? `Assessment complete. Probability ${result.data.probability}%.`);
      }
    } catch {
      if (!controller.signal.aborted) { setError('Could not complete the assessment.'); setAnnouncement(''); }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      active.current = null;
    }
  }

  /** Dismiss outage controls without refreshing the prior result. */
  function keep() {
    const result = keepLastScore(store, {siteId: site.id});
    if (result.ok) {
      setDismissed(true);
      setAnnouncement('Last score retained.');
    } else setError(result.error.message);
  }

  return (
    <section className="space-y-3" aria-label="Assessment prediction">
      {readiness.evidenceChanged && site.scoreState === 'needs_rescore' && <p role="status" className="card p-3">{RESCORE_NOTICE}</p>}
      {site.scoreState === 'unsupported' && <p className="card p-3">{UNSUPPORTED_REPLAY}</p>}
      {outage && (
        <div className="card space-y-2 border-amber bg-amber-wash p-4">
          <h2>Assessment service unavailable</h2>
          <p>Assessment service unavailable. No new score was returned.{priorTime && ` Showing the score from ${priorTime}.`}</p>
          {!dismissed && canRetry && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run('retry')}>Retry</button>
              <button type="button" className="btn" disabled={busy || !lastScore} onClick={keep}>Keep last score</button>
            </div>
          )}
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="card space-y-3 p-4">
          <p className="meta font-semibold">Assessment</p>
          <h2>{closed ? 'Score at close' : historical ? 'Last score · Historical' : 'Readiness probability'}</h2>
          <p className={value == null ? 'text-title font-semibold' : 'prediction-score'}>{value == null ? (closed ? '—' : 'Unavailable') : `${value}%`}</p>
          {closed && <p>This site is on air. No current forecast applies.</p>}
          {dispatched && <p>This site is dispatched. The recorded result is not a new forecast.</p>}
          {!closed && !dispatched && !horizonEligible && <p>The planned date is outside the assessment horizon. No current forecast applies.</p>}
          {lastScore?.plannedDay && <p>{historical ? 'Recorded chance ready on' : 'Chance ready on'} {formatDate(lastScore.plannedDay)}.</p>}
          {lastScore && (
            <div className="space-y-1">
              <p>Confidence: {lastScore.confidence}% · {confidenceBand(lastScore.confidence)}</p>
              {isHarbor && lastScore.confidence === 86 && (
                <p>Evidence is complete enough to rank the blocker. It is not enough to dispatch through a failed prerequisite.</p>
              )}
              <div className="h-2 overflow-hidden rounded-control bg-line" aria-hidden="true">
                <div className="h-full bg-teal" style={{width: `${lastScore.confidence}%`}} />
              </div>
              <p className="meta">Scored {formatDate(lastScore.scoredAt)} {clockTime} · {lastScore.model} · {lastScore.correlationId}</p>
            </div>
          )}
          {horizon && <p className="meta">Assessment horizon: {horizon}</p>}
          {canRun && (
            <button type="button" className="btn" disabled={busy} onClick={() => run('run')}>
              Run assessment
            </button>
          )}
          {!canRun && horizonEligible && <p className="meta">Operators, the Approver and the cluster administrator can run assessments.</p>}
          <p role="status" aria-live="polite">{announcement}</p>
          {error && <p role="alert" className="text-red">{error}</p>}
        </div>
        <div className="card space-y-3 p-4">
          <h2>What the score used</h2>
          {!!factors.length && (
            <ul className="divide-y divide-line" aria-label="Score factors">
              {factors.map(factor => {
                const path = factorLink(site, factor);
                return (
                  <li key={factor.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2">
                    <span>{factor.label}</span>
                    <span className="font-semibold">{factor.points < 0 ? '−' : '+'}{Math.abs(factor.points)} points</span>
                    <div className="grid grid-cols-2" aria-hidden="true">
                      <div className="flex h-2 justify-end border-r border-muted bg-surface">
                        {factor.points < 0 && <div className="bg-teal" style={{width: `${Math.abs(factor.points) / scale * 100}%`}} />}
                      </div>
                      <div className="h-2 bg-surface">
                        {factor.points > 0 && <div className="bg-amber" style={{width: `${factor.points / scale * 100}%`}} />}
                      </div>
                    </div>
                    <Link className="btn justify-self-end" to={path} aria-label={`View evidence: ${factor.label}`}>View evidence</Link>
                  </li>
                );
              })}
            </ul>
          )}
          {!!factors.length && <p className="meta">These are contributions to the score. They are not causes.</p>}
          {factors.length < 3 && (
            <div>
              <h3>Related context</h3>
              <ul className="mt-1 space-y-1">
                {contextFor(site, factors).map(([label, path]) => (
                  <li key={label}>
                    <Link className="btn text-left" to={path}>{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lastScore?.limitation && <p>{lastScore.limitation}</p>}

          <p className="meta">Low confidence, missing evidence, and conflicting sources are not filled in with a guess.</p>
        </div>
      </div>
    </section>
  );
}

PredictionPanel.propTypes = {board: PropTypes.object.isRequired, site: PropTypes.object.isRequired, actor: PropTypes.object.isRequired,
  store: PropTypes.object.isRequired, readiness: PropTypes.object.isRequired};
