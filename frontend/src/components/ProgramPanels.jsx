/** Render scoped crew plans, event history and the Board exception summary. */
import {useEffect, useRef} from 'react';
import PropTypes from 'prop-types';
import {Link, useLocation} from 'react-router-dom';
import {formatDate, morningActivity, personName, sitePath, withOperationalParams} from '../utils/portfolio.js';

/** Show exception totals and open each affected site directly. */
export function ExceptionSummary({groups, active, boardPath}) {
  return (
    <section className="card p-4" aria-labelledby="exception-title">
      <h2 id="exception-title" className="program-section-title">Exceptions</h2>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {groups.map(({id, label, sites}) => (
          <li className="min-w-0 space-y-2" key={id}>
            {sites.length ? (
              <Link className={`btn !whitespace-normal ${active === id ? 'border-teal bg-surface' : ''}`} aria-current={active === id ? 'true' : undefined}
                to={active === id ? boardPath : withOperationalParams(boardPath, {exception: id})}>{sites.length} {label}</Link>
            ) : <p className="px-2 py-2 font-medium">0 {label}</p>}
            {sites.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label={`Sites with ${label}`}>
                {sites.map(site => (
                  <li key={site.id}>
                    <Link className="btn !min-h-0 !px-2 !py-1 !whitespace-normal" to={sitePath(site.id)}>{site.name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

ExceptionSummary.propTypes = {groups: PropTypes.arrayOf(PropTypes.object).isRequired, active: PropTypes.string, boardPath: PropTypes.string.isRequired};

/** Link released sites without making archived records point to missing pages. */
function SiteControl({siteId, sites, label}) {
  return sites[siteId] ? <Link className="btn !whitespace-normal" to={sitePath(siteId)}>{label}</Link> : <p className="font-semibold">{label}</p>;
}

SiteControl.propTypes = {siteId: PropTypes.string, sites: PropTypes.object.isRequired, label: PropTypes.string.isRequired};

/** List this program’s crew assignments and planned visits, optionally narrowed to visits at stake. */
export function ProgramSchedule({board, atStake, schedulePath}) {
  const {program, sites} = board;
  const stake = new Set(program.visitsAtStake);
  const crews = atStake ? program.crew.filter(crew => stake.has(crew.siteId)) : program.crew;
  const visits = Object.values(sites).filter(site => site.lifecycle !== 'on_air' && site.plan.plannedDay && (!atStake || stake.has(site.id)))
    .sort((a, b) => a.plan.plannedDay.localeCompare(b.plan.plannedDay) || a.id.localeCompare(b.id));
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1>Schedule</h1>
        {atStake && <Link className="btn" to={schedulePath}>Show full schedule</Link>}
      </header>
      {atStake && <p className="font-semibold">Visits at stake this week</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card p-4" aria-labelledby="crew-title">
          <h2 className="program-section-title" id="crew-title">Crews this week</h2>
          {crews.length ? <ul className="mt-2 divide-y divide-line">
            {crews.map(crew => (
              <li key={crew.id} className="space-y-1 py-3">
                <SiteControl sites={sites} siteId={crew.siteId} label={sites[crew.siteId]?.name ?? 'Hold day'} />
                <p>{crew.state}</p>
                <p className="meta"><time dateTime={crew.shiftAt ?? crew.shiftDay}>{formatDate(crew.shiftAt ?? crew.shiftDay, true)}</time>
                  {crew.leadId && ` · ${personName(board, crew.leadId)} · Crew of ${crew.size} · ${crew.depot}`}</p>
              </li>
            ))}
          </ul> : <p className="meta mt-2">No crew assignments to show.</p>}
        </section>
        <section className="card p-4" aria-labelledby="planned-title">
          <h2 className="program-section-title" id="planned-title">Planned visits</h2>
          {visits.length ? <ul className="mt-2 divide-y divide-line">
            {visits.map(site => (
              <li key={site.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <SiteControl sites={sites} siteId={site.id} label={site.name} />
                <time className="meta" dateTime={site.plan.plannedDay}>{formatDate(site.plan.plannedDay)}</time>
              </li>
            ))}
          </ul> : <p className="meta mt-2">No planned visits to show.</p>}
        </section>
      </div>
    </div>
  );
}

ProgramSchedule.propTypes = {board: PropTypes.object.isRequired, atStake: PropTypes.bool.isRequired, schedulePath: PropTypes.string.isRequired};

/** Show the curated morning feed and quarterly failures for the current program. */
export function ProgramActivity({board}) {
  const {program, sites} = board;
  const morning = morningActivity(program);
  const {hash} = useLocation();
  const failuresHeading = useRef(null);
  useEffect(() => {
    if (hash !== '#failures-title') return;
    failuresHeading.current?.focus({preventScroll: true});
    failuresHeading.current?.scrollIntoView?.({block: 'start'});
  }, [hash]);
  return (
    <div className="space-y-5">
      <h1>Activity</h1>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card p-4" aria-labelledby="morning-title">
          <h2 id="morning-title" className="program-section-title">Morning log</h2>
          {morning.length ? <ol className="mt-2 divide-y divide-line">
            {morning.map(entry => (
              <li key={entry.id} className="space-y-1 py-3">
                <SiteControl sites={sites} siteId={entry.siteId} label={`${entry.verb} · ${entry.siteName}`} />
                <p>{entry.detail}</p>
                <p className="meta"><time dateTime={entry.at}>{formatDate(entry.at, true)}</time> · {entry.actorLabel}</p>
              </li>
            ))}
          </ol> : <p className="meta mt-2">No morning activity.</p>}
        </section>
        <section className="card p-4" aria-labelledby="failures-title">
          <h2 id="failures-title" ref={failuresHeading} tabIndex={-1} className="program-section-title">Failed visits this quarter</h2>
          {program.failures.length ? <ul className="mt-2 divide-y divide-line">
            {program.failures.map(entry => (
              <li key={entry.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SiteControl sites={sites} siteId={entry.siteId} label={entry.name} />
                  <span className={`badge ${entry.state === 'Open' ? 'risk-red' : 'risk-green'}`}>{entry.state}</span>
                </div>
                <p className="meta">{entry.siteId} · <time dateTime={entry.whenAt ?? entry.whenDay}>{formatDate(entry.whenAt ?? entry.whenDay, true)}</time></p>
                <p>{entry.outcome}</p>
                <p className="meta">{entry.detail}</p>
              </li>
            ))}
          </ul> : <p className="meta mt-2">No failed visits this quarter.</p>}
        </section>
      </div>
    </div>
  );
}

ProgramActivity.propTypes = {board: PropTypes.object.isRequired};
