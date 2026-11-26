/** Compose the full-board summary with independently filtered released sites. */
import {useState} from 'react';
import PropTypes from 'prop-types';
import {Link} from 'react-router-dom';
import {Icon} from '../components/icons.jsx';
import {ReadinessTable} from '../components/ReadinessTable.jsx';
import {PROGRAMS, makeProgramBoard, programPath} from '../data/programs.js';
import {FILTERS, formatDate, formatMonth, personName, RISK_STYLE, selectPortfolio, sitePath} from '../utils/portfolio.js';

const riskLabels = {Green: 'Good', Amber: 'Needs Attention', Red: 'Critical'};
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

/** Keep the existing register and filters available until the triage slice refines them. */
export function ProgramBoard({board, programId, query}) {
  const [chip, setChip] = useState('All');
  const [exception, setException] = useState(null);
  const [sort, setSort] = useState(null);
  const model = selectPortfolio(board, {query, chip, sort, exception});
  const {program} = board;
  const names = sites => sites.map(site => site.name).join(' and ');
  const stats = [
    ['Sites at risk', model.atRisk, `of ${model.total} sites`, `${model.hold} on hold · ${model.dispatched} dispatched`],
    ['Visits at stake this week', model.visitsAtStake.length, '', names(model.visitsAtStake)],
    ['Failed visits this quarter', model.failed, '', `${model.failedOpen} still open`],
    ['On air in May', model.onAir.length, '', names(model.onAir)],
  ];

  /** Flip only the chosen comparator, including the initial ascending Risk heading. */
  function changeSort(key) {
    setSort(current => ({key, direction: (current?.key === key && current.direction === 'ascending') || (!current && key === 'risk') ? 'descending' : 'ascending'}));
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-3" aria-labelledby="portfolio-title">
        <div>
          <h1 id="portfolio-title" className="text-title font-semibold text-ink">{program.cluster}</h1>
          <p className="mt-2 font-medium">{PROGRAMS[programId].decision}</p>
        </div>
        <Link className="btn btn-primary" to={sitePath(PROGRAMS[programId].focus)}>
          Review {board.sites[PROGRAMS[programId].focus].name}
          <Icon name="arrow" />
        </Link>
      </section>
      <section aria-label="Portfolio totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, qualifier, detail]) => (
          <article className="card p-4" key={label}>
            <h2 className="font-medium text-ink">{label}</h2>
            <p className="mt-2 flex items-baseline gap-1.5 text-kpi font-semibold text-ink">
              {value}
              {qualifier && <span className="meta font-normal">{qualifier}</span>}
            </p>
            <p className="meta mt-1">{detail}</p>
          </article>
        ))}
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card p-4" aria-labelledby="readiness-trend">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="readiness-trend" className="text-base font-semibold text-ink">Portfolio readiness</h2>
              <p className="meta">Share of the Board rated Good.</p>
            </div>
            <svg
              role="img"
              aria-label={`14-day Good share trend: ${program.trend.map(entry => `${entry.greenShare}%`).join(', ')}`}
              viewBox="0 0 130 40"
              className="h-12 w-32 shrink-0"
            >
              <path aria-hidden="true" d="M0 34H130M0 10H130" className="stroke-line" />
              <polyline
                points={program.trend.map((entry, index) => `${2 + index * 9.7},${38 - 0.36 * entry.greenShare}`).join(' ')}
                className="fill-none stroke-teal"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div aria-hidden="true" className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
            {Object.entries(model.risk).map(([risk, value]) => value > 0 && <span key={risk} className={risk === 'Green' ? 'program-good-fill' : RISK_STYLE[risk].fill} style={{flexGrow: value}} />)}
          </div>
          <ul className="mt-2 flex flex-wrap gap-3">
            {Object.entries(model.risk).map(([risk, value]) => (
              <li key={risk} className={`inline-flex items-center gap-1 text-meta ${RISK_STYLE[risk].ink}`}>
                <Icon name={risk} />
                {riskLabels[risk]} {value}
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-4" aria-labelledby="exception-title">
          <h2 id="exception-title" className="text-base font-semibold text-ink">Exceptions</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {model.exceptions.map(group => (
              <li key={group.id} className="min-w-0">
                <button
                  type="button"
                  className={`btn ${
                    exception === group.id ? 'border-teal bg-green-wash text-teal-ink' : 'border-transparent text-ink hover:bg-surface'}`}
                  aria-pressed={exception === group.id}
                  onClick={() => {
                    setChip('All');
                    setException(exception === group.id ? null : group.id);
                  }}
                >
                  {group.sites.length} {group.label}
                </button>
                <ul className="flex flex-wrap gap-x-2 px-2 text-meta">
                  {group.sites.map(site => (
                    <li key={site.id}>
                      <Link className="btn" to={sitePath(site.id)}>{site.name}</Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section aria-label="Released-site filters" className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(label => (
            <button
              key={label}
              type="button"
              aria-pressed={!exception && chip === label}
              className={`btn ${
                !exception && chip === label ? 'border-teal bg-green-wash text-teal-ink' : 'border-line bg-card text-ink hover:border-muted'}`}
              onClick={() => {
                setChip(label);
                setException(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p role="status" className="meta">
          Showing {model.visible.length} of {model.total} sites.
        </p>
      </section>
      <ReadinessTable board={board} sites={model.visible} sort={sort} onSort={changeSort} />
    </div>
  );
}

ProgramBoard.propTypes = {board: PropTypes.object.isRequired, programId: PropTypes.string.isRequired, query: PropTypes.string.isRequired};

/** Present scoped schedule, activity or pending-site links pending dedicated workflow views. */
export function ProgramList({board, page}) {
  const {program, sites} = board;
  const crews = program.crew.map(item => ({id: item.id, siteId: item.siteId, label: sites[item.siteId]?.name ?? 'Hold day',
    detail: [formatDate(item.shiftAt ?? item.shiftDay, true), item.state,
      item.leadId && `${personName(board, item.leadId)} · Crew of ${item.size} · ${item.depot}`].filter(Boolean).join(' · ')}));
  const morning = [...program.morning].reverse().filter(item => item.verb !== 'Scored').map(item => ({id: item.id, siteId: item.siteId,
    label: `${item.verb} · ${item.siteName}`, detail: `${formatDate(item.at, true)} · ${item.detail}`}));
  const failed = program.failures.map(item => ({id: item.id, siteId: item.siteId, label: item.name,
    detail: `${item.state} · ${formatDate(item.whenAt ?? item.whenDay, true)} · ${item.outcome} ${item.detail}`}));
  const approvals = Object.values(sites).filter(site => site.proposal?.state === 'Pending approval').map(site => ({
    id: site.id, siteId: site.id, label: site.name, detail: site.proposal.impact}));
  const groups = {Schedule: [['Crews and planned visits', crews]], Activity: [['Morning log', morning], ['Failed visits', failed]],
    Approvals: [['Waiting on the program manager', approvals]]};
  return (
    <div className="space-y-5">
      <h1>{page}</h1>
      {groups[page].map(([title, entries]) => (
        <section key={title} className="card p-4" aria-label={title}>
          <h2 className="program-section-title">{title}</h2>
          {entries.length ? (
            <ul className="mt-2 divide-y divide-line">
              {entries.map(({id, siteId, label, detail}) => (
                <li key={id} className="space-y-2 py-3">
                  {sites[siteId] ? (
                    <Link className="btn" to={`${sitePath(siteId)}${page === 'Approvals' ? '?tab=approval' : ''}`}>{label}</Link>
                  ) : <p className="font-medium">{label}</p>}
                  <p>{detail}</p>
                </li>
              ))}
            </ul>
          ) : <p className="pt-2 text-muted">No records for this program.</p>}
        </section>
      ))}
    </div>
  );
}

ProgramList.propTypes = {board: PropTypes.object.isRequired, page: PropTypes.oneOf(['Schedule', 'Activity', 'Approvals']).isRequired};
