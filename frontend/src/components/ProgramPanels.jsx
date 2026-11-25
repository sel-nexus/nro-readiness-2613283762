/** Render the released schematic and the independent program history and planning panels. */
import PropTypes from 'prop-types';
import {Link} from 'react-router-dom';
import {Icon} from './icons.jsx';
import {formatDate, formatMonth, morningActivity, personName, RISK_STYLE, sitePath} from '../utils/portfolio.js';

/** Plot the visible sites in board coordinates without requesting external map assets. */
export function SiteSchematic({sites}) {
  return (
    <section aria-labelledby="schematic-title" className="card min-w-0 p-4">
      <h2 id="schematic-title" className="text-base font-semibold text-ink">Cluster schematic</h2>
      <p className="meta mt-1">{sites.length} visible sites</p>
      <svg className="mx-auto mt-3 w-full max-w-xs rounded-control border border-line bg-surface" viewBox="0 0 100 100" aria-label="West Metro site positions">
        <path aria-hidden="true" d="M20 0v100M40 0v100M60 0v100M80 0v100M0 20h100M0 40h100M0 60h100M0 80h100" className="stroke-line" strokeWidth=".3" />
        <path aria-hidden="true" d="M7 0 12 23 27 42 32 66 21 100M0 61l30-14 38-10 32 4M0 79l38 6 23-4 39-18"
          className="fill-none stroke-line" strokeWidth="1" />
        {sites.map(({id, name, risk, x, y}) => (
          <Link key={id} to={sitePath(id)} aria-label={`${name} · ${id} · ${risk}`} className={`group ${RISK_STYLE[risk].ink}`}>
            <title>{name} · {risk}</title>
            <circle cx={x} cy={y} r="2.9"
              className="fill-card stroke-current opacity-80 group-hover:opacity-100 group-focus-visible:opacity-100"
              strokeWidth=".28" />
            {risk === 'Green' && <circle cx={x} cy={y} r="1.4" fill="currentColor" />}
            {risk === 'Amber' && <path transform={`translate(${x} ${y})`} d="M0-1.9 1.9 0 0 1.9-1.9 0Z" fill="currentColor" />}
            {risk === 'Red' && <rect x={x - 1.35} y={y - 1.35} width="2.7" height="2.7" fill="currentColor" />}
          </Link>
        ))}
      </svg>
      <ul className="mt-3 flex flex-wrap gap-3 text-meta" aria-label="Risk key">
        {['Green', 'Amber', 'Red'].map(risk => (
          <li key={risk} className={`inline-flex items-center gap-1 ${RISK_STYLE[risk].ink}`}>
            <Icon name={risk} />
            {risk}
          </li>
        ))}
      </ul>
    </section>
  );
}

SiteSchematic.propTypes = {sites: PropTypes.arrayOf(PropTypes.object).isRequired};

/** Display all planning/history panels using their own independent program records. */
export function ProgramPanels({board}) {
  const {program, sites} = board;
  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      <section className="card min-w-0 p-4" aria-labelledby="morning-title">
        <h2 id="morning-title" className="text-base font-semibold text-ink">This morning</h2>
        <ol className="mt-3 divide-y divide-line">
          {morningActivity(program).map(entry => (
            <li key={entry.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-2">
              <time className="meta" dateTime={entry.at}>{formatDate(entry.at, true)}</time>
              <div>
                <p className="font-semibold">{entry.verb} · {entry.siteName}</p>
                <p className="meta">{entry.actorLabel} · {entry.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="card min-w-0 p-4" aria-labelledby="crew-title">
        <h2 id="crew-title" className="text-base font-semibold text-ink">Crews this week</h2>
        <ul className="mt-3 divide-y divide-line">
          {program.crew.map(crew => (
            <li key={crew.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-2">
              <time className="meta" dateTime={crew.shiftAt ?? crew.shiftDay}>{formatDate(crew.shiftAt ?? crew.shiftDay, true)}</time>
              <div>
                <p className="font-semibold">{crew.siteId ? sites[crew.siteId].name : 'Hold day'}</p>
                <p>{crew.state}</p>
                {crew.leadId && <p className="meta">{personName(board, crew.leadId)} · Crew of {crew.size} · {crew.depot}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card min-w-0 p-4" aria-labelledby="failures-title">
        <h2 id="failures-title" className="text-base font-semibold text-ink">Failed visits this quarter</h2>
        <ul className="mt-3 divide-y divide-line">
          {program.failures.map(entry => (
            <li key={entry.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {sites[entry.siteId] ? (
                  <Link className="font-semibold text-teal-ink underline-offset-4 hover:underline" to={sitePath(entry.siteId)}>{entry.name}</Link>
                ) : <span className="font-semibold">{entry.name}</span>}
                <span className={`badge ${entry.state === 'Open' ? 'risk-red' : 'risk-green'}`}>{entry.state}</span>
              </div>
              <p className="meta">{entry.siteId} · {formatDate(entry.whenAt ?? entry.whenDay, true)}</p>
              <p className="mt-1">{entry.outcome}</p>
              <p className="meta">{entry.detail}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="card min-w-0 p-4" aria-labelledby="design-title">
        <h2 id="design-title" className="text-base font-semibold text-ink">Not on the board yet</h2>
        <ul className="mt-3 divide-y divide-line">
          {program.design.map(entry => (
            <li key={entry.siteId} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <p className="font-semibold">{entry.name}</p>
                <p className="meta">{entry.siteId} · {entry.neighborhood}</p>
              </div>
              <p className="meta sm:text-right">{entry.state} · {formatMonth(entry.targetMonth)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

ProgramPanels.propTypes = {board: PropTypes.object.isRequired};
