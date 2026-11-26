/** Compose the full-board summary with independently filtered released sites. */
import {useState} from 'react';
import PropTypes from 'prop-types';
import {Link, useNavigate, useSearchParams} from 'react-router-dom';
import {Icon} from '../components/icons.jsx';
import {ExceptionSummary} from '../components/ProgramPanels.jsx';
import {ReadinessTable} from '../components/ReadinessTable.jsx';
import {PROGRAMS, makeProgramBoard, programPath} from '../data/programs.js';
import {FILTERS, formatDate, formatMonth, personName, RISK_LABELS, RISK_STYLE, selectPortfolio, sitePath, withOperationalParams} from '../utils/portfolio.js';

const catalog = Object.entries(PROGRAMS).map(([id, meta]) => ({id, ...meta, seed: makeProgramBoard(id)}));

/** List all program cards and their design queues without exposing workshop diagnostics. */
export default function Portfolio() {
  return (
    <div className="space-y-5">
      <header>
        <h1>Programs</h1>
        <p className="mt-2 text-muted">Open a program to review its readiness board, crew plans and decisions.</p>
      </header>
      <ul aria-label="Available programs" className="grid gap-4">
        {catalog.map(({id, name, region, quarter, state, lead, lastUpdate, seed}) => (
          <li key={id}>
            <article className="card space-y-4 p-4 sm:p-6" aria-labelledby={`program-${id}`}>
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-muted">{region} · {quarter} · {state}</p>
                  <h2 id={`program-${id}`} className="program-section-title">{name}</h2>
                </div>
                <Link className="btn" to={programPath('/board', id)} aria-label={`Open ${name}`}>
                  Open Board <Icon name="arrow" />
                </Link>
              </header>
              <p><strong>{Object.keys(seed.sites).length}</strong> sites on the Board · <strong>{seed.program.design.length}</strong> in design</p>
              <p className="text-muted">Lead: {lead} · {lastUpdate}</p>
              <section className="program-group border-t border-line p-3" aria-label={`${name} design queue`}>
                <h3>Design queue</h3>
                {seed.program.design.length ? (
                  <ul className="mt-2 divide-y divide-line">
                    {seed.program.design.map(entry => (
                      <li key={entry.siteId} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
                        <div>
                          <p className="font-medium">{entry.name}</p>
                          <p className="meta">{entry.siteId} · {entry.neighborhood}</p>
                          {entry.blocker && <p className="meta">{entry.blocker} · {personName(seed, entry.ownerId)} · Planning estimate: {entry.probability}%</p>}
                        </div>
                        <p className="meta">{entry.state} · {entry.plannedDay ? formatDate(entry.plannedDay) : formatMonth(entry.targetMonth)}</p>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-1 text-muted">No sites in design.</p>}
              </section>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Render the immediate decision, scope-wide signals and filtered site register. */
export function ProgramBoard({board, programId, query}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [sort, setSort] = useState(null);
  const filter = params.get('filter');
  const chip = [...FILTERS, 'At risk', 'On air this month'].includes(filter) ? filter : 'All';
  const owner = params.get('owner');
  const exception = params.get('exception');
  const model = selectPortfolio(board, {query, chip, sort, exception, owner});
  const {cluster} = board.program;
  const {decision, focus} = PROGRAMS[programId];
  const boardPath = programPath('/board', programId);
  const stats = [
    ['Sites at risk', model.atRisk, `of ${model.total} sites`, withOperationalParams(boardPath, {filter: 'At risk'})],
    ['Visits at stake this week', model.visitsAtStake.length, null, withOperationalParams(programPath('/schedule', programId), {view: 'at-stake'})],
    ['Failed visits this quarter', model.failed, `${model.failedOpen} still open`, `${programPath('/activity', programId)}#failures-title`],
    ['On air this month', model.onAir.length, null, withOperationalParams(boardPath, {filter: 'On air this month'})],
  ];

  /** Flip the chosen comparator, including the initial ascending Risk heading. */
  function changeSort(key) {
    setSort(current => ({key, direction: (current?.key === key && current.direction === 'ascending') || (!current && key === 'risk') ? 'descending' : 'ascending'}));
  }

  return (
    <div className="space-y-5" aria-label="Program Board">
      <section className="flex flex-wrap items-end justify-between gap-3" aria-labelledby="portfolio-title">
        <div>
          <h1 id="portfolio-title">{cluster}</h1>
          <p className="mt-2 text-lg font-semibold">{decision}</p>
        </div>
        <Link className="btn btn-primary" to={sitePath(focus)}>
          Review {board.sites[focus].name}
          <Icon name="arrow" />
        </Link>
      </section>
      <section aria-label="Portfolio totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(([label, value, detail, to]) => (
          <Link className="btn !flex !h-full !min-w-0 !flex-col !items-start !justify-start !gap-2 !whitespace-normal !p-4 text-left" key={label} to={to}>
            <span className="font-medium">{label}</span>
            <span className="flex items-baseline gap-1.5 tabular-nums">
              <strong className="text-kpi text-[var(--primary)]">{value}</strong>
              {detail && <span className="meta">{detail}</span>}
            </span>
          </Link>
        ))}
      </section>
      <section className="card grid gap-4 p-4 md:grid-cols-2" aria-label="Portfolio readiness">
        <div>
          <h2 className="program-section-title">Risk distribution</h2>
          <div aria-hidden="true" className="mt-3 flex h-2 gap-0.5 overflow-hidden">
            {Object.entries(model.risk).map(([risk, value]) => value > 0 && <span key={risk} className={risk === 'Green' ? 'program-good-fill' : RISK_STYLE[risk].fill} style={{flexGrow: value}} />)}
          </div>
          <ul className="mt-2 flex flex-wrap gap-3">
            {Object.entries(model.risk).map(([risk, value]) => (
              <li key={risk} className={`inline-flex items-center gap-1 text-meta ${RISK_STYLE[risk].ink}`}>
                <Icon name={risk} /> {RISK_LABELS[risk]} {value}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="program-section-title">14-day readiness trend</h2>
            <p className="meta">Recorded share of sites rated Good</p>
          </div>
          {model.trend.length ? (
            <svg role="img"
              aria-label={`14-day Good share trend: ${model.trend.map(({day, greenShare}) => `${formatDate(day)} ${greenShare}%`).join(', ')}`}
              viewBox="0 0 130 40" className="h-12 w-32 shrink-0">
              <path d="M0 34H130M0 10H130" className="stroke-line" />
              <polyline points={model.trend.map(({greenShare}, i) => `${2 + i * 9.7},${38 - 0.36 * greenShare}`).join(' ')}
                className="fill-none stroke-teal" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          ) : <p className="meta">No recorded trend.</p>}
        </div>
      </section>
      <ExceptionSummary groups={model.exceptions} active={exception} boardPath={boardPath} />
      <section aria-label="Released-site filters" className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(label => (
            <button key={label} type="button" aria-pressed={!exception && chip === label}
              className={`btn ${!exception && chip === label ? 'border-teal bg-surface' : ''}`}
              onClick={() => navigate(withOperationalParams(boardPath, {filter: label === 'All' ? null : label, owner}))}>
              {label}
            </button>
          ))}
        </div>
        {(owner || !FILTERS.includes(chip)) && (
          <p className="flex flex-wrap items-center gap-2">
            <span>{[owner && `Next owner: ${personName(board, owner)}`, !FILTERS.includes(chip) && chip].filter(Boolean).join(' · ')}</span>
            <Link className="btn" to={boardPath}>Clear filters</Link>
          </p>
        )}
        <p role="status" className="meta">Showing {model.visible.length} of {model.total} sites.</p>
        <ReadinessTable board={board} sites={model.visible} sort={sort} onSort={changeSort}
          ownerPath={ownerId => withOperationalParams(boardPath, {owner: ownerId})} />
      </section>
    </div>
  );
}

ProgramBoard.propTypes = {board: PropTypes.object.isRequired, programId: PropTypes.string.isRequired, query: PropTypes.string.isRequired};

/** Present a temporary pending-site list until the approval workflow is implemented. */
export function ProgramList({board}) {
  const {sites} = board;
  const approvals = Object.values(sites).filter(site => site.proposal?.state === 'Pending approval');
  return (
    <div className="space-y-5">
      <h1>Approvals</h1>
      <section className="card p-4" aria-labelledby="pending-approvals">
        <h2 id="pending-approvals" className="program-section-title">Waiting on the program manager</h2>
        {approvals.length ? (
          <ul className="mt-2 divide-y divide-line">
            {approvals.map(site => (
              <li key={site.id} className="space-y-2 py-3">
                <Link className="btn" to={`${sitePath(site.id)}?tab=approval`}>{site.name}</Link>
                <p>{site.proposal.impact}</p>
              </li>
            ))}
          </ul>
        ) : <p className="pt-2 text-muted">No records for this program.</p>}
      </section>
    </div>
  );
}

ProgramList.propTypes = {board: PropTypes.object.isRequired};
