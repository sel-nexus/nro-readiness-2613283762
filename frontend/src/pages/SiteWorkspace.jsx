/** Share a site frame and URL-backed tabs across provenance and workflow views. */
import {useEffect, useRef} from 'react';
import PropTypes from 'prop-types';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {ApprovalPanel} from '../components/ApprovalPanel.jsx';
import {AuditPanel} from '../components/AuditPanel.jsx';
import {EvidenceMatrix} from '../components/EvidenceMatrix.jsx';
import {FieldStrip} from '../components/FieldStrip.jsx';
import {PredictionPanel} from '../components/PredictionPanel.jsx';
import {Recommendation} from '../components/Recommendation.jsx';
import {BOARD_AT, SUPPLIERS} from '../data/register.js';
import {formatDate, personName, RISK_STYLE, sitePath} from '../utils/portfolio.js';
import {confidenceBand, deriveReadiness} from '../utils/readiness.js';

const TABS = [['evidence', 'Evidence'], ['prediction', 'Prediction'], ['action', 'Blockers and action'], ['approval', 'Approval'], ['audit', 'Audit']];

/** Render the exact site supplied by the route guard, sharing one committed context. */
export default function SiteWorkspace({board, site, actor, store, notify}) {
  const location = useLocation();
  const navigate = useNavigate();
  const frame = useRef(null);
  const requested = new URLSearchParams(location.search).get('tab');
  const index = Math.max(0, TABS.findIndex(([key]) => key === requested));
  const [tab, title] = TABS[index];
  const target = location.hash.slice(1);
  const optionId = typeof location.state?.optionId === 'string' ? location.state.optionId : null;
  const snapshot = board.audit.snapshots[site.assessment?.snapshotId];
  const readiness = deriveReadiness(site, BOARD_AT, board.faults, snapshot);
  const {lastScore, current, confidence, risk, disposition} = readiness;
  const onAir = site.lifecycle === 'on_air';
  const scoreLabel = !current && !onAir ? 'Last probability (historical)' : 'Probability';
  const probability = onAir ? '—' : lastScore?.probability == null ? 'Unavailable' : `${lastScore.probability}%`;
  const supplier = SUPPLIERS[site.plan.supplierId];
  const notes = [...site.notes].reverse().sort((a, b) => b.at.localeCompare(a.at));
  const auditCount = board.audit.events.filter(event => event.siteId === site.id).length;
  const crewRev = board.program.crew.find(item => item.siteId === site.id)?.rev ?? null;
  const props = {board, site, actor, store, notify, readiness, target};

  useEffect(() => {
    const previous = document.title;
    document.title = `${site.name} · NRO Readiness`;
    return () => { document.title = previous; };
  }, [site.name]);

  useEffect(() => {
    if (!target || tab === 'evidence') return;
    const element = [...frame.current.querySelectorAll('[id]')].find(node => node.id === target);
    element?.focus();
  }, [tab, target, site.rev]);

  /** Move focus and select the next URL tab with standard tablist keys. */
  function moveTab(event) {
    const next = {ArrowRight: (index + 1) % TABS.length, ArrowLeft: (index + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1}[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const key = TABS[next][0];
    frame.current.querySelector(`#tab-${key}`).focus();
    navigate(`${sitePath(site.id)}?tab=${key}`);
  }

  return (
    <div className="space-y-3" ref={frame}>
      <Link to="/" className="inline-block font-medium underline">Back to Portfolio</Link>
      <header className="card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="meta font-medium">{site.id}</p>
            <h1>{site.name}</h1>
            <p className="text-muted">{site.neighborhood}</p>
          </div>
          <span className={`badge ${RISK_STYLE[risk].badge}`}>{risk}</span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" id="site-plan" tabIndex={-1}>
          <div>
            <dt className="meta">Planned installation</dt>
            <dd className="font-medium">{formatDate(site.plan.plannedDay)}</dd>
          </div>
          <div>
            <dt className="meta">Supplier · Agreement</dt>
            <dd className="font-medium">{supplier.name} · {site.plan.agreementId}</dd>
          </div>
          <div>
            <dt className="meta">{scoreLabel} · Confidence</dt>
            <dd className="font-medium">{probability} · {lastScore ? `${lastScore.confidence}% (${confidenceBand(lastScore.confidence)})` : '—'}</dd>
            {lastScore && confidence !== lastScore.confidence && <dd className="meta">Working confidence: {confidence}%</dd>}
          </div>
          <div>
            <dt className="meta">Disposition · Next owner</dt>
            <dd className="font-medium">{disposition} · {personName(board, site.ownerId)}</dd>
          </div>
        </dl>
        {lastScore && <p className="meta">Scored {formatDate(lastScore.scoredAt, true)} · {lastScore.model} · {lastScore.correlationId}</p>}
      </header>
      {!!notes.length && (
        <section className="card p-4" aria-label="Site notes">
          <h2>Site notes</h2>
          <ul className="mt-2 divide-y divide-line">
            {notes.map(note => (
              <li key={note.id} className="py-2">
                <p className="meta">{personName(board, note.actorId)} · {formatDate(note.at, true)}</p>
                <p className="break-words">{note.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div role="tablist" aria-label="Site workspace" className="flex overflow-x-auto border-b border-line bg-card">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" id={`tab-${key}`} aria-controls="workspace-pane" aria-selected={key === tab}
            tabIndex={key === tab ? 0 : -1} onKeyDown={moveTab} onClick={() => navigate(`${sitePath(site.id)}?tab=${key}`)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 font-medium ${tab === key ? 'border-teal text-teal-ink' : 'border-transparent text-muted hover:bg-surface'}`}>
            {label}{key === 'audit' ? ` (${auditCount})` : ''}
          </button>
        ))}
      </div>
      <section role="tabpanel" id="workspace-pane" aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {tab === 'evidence' && <EvidenceMatrix {...props} />}
        {tab === 'prediction' && <PredictionPanel {...props} />}
        {tab === 'action' && (
          <div className="space-y-3">
            <Recommendation {...props} />
            <FieldStrip {...props} />
          </div>
        )}
        {tab === 'approval' && (
          <ApprovalPanel key={JSON.stringify([site.rev, board.faults.rev, crewRev, optionId])} {...props} optionId={optionId} />
        )}
        {tab === 'audit' && <AuditPanel {...props} />}
      </section>
    </div>
  );
}

SiteWorkspace.propTypes = {board: PropTypes.object.isRequired, site: PropTypes.object.isRequired, actor: PropTypes.object.isRequired,
  store: PropTypes.object.isRequired, notify: PropTypes.func.isRequired};
