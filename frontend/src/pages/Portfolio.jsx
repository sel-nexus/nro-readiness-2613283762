/** Compose the full-board summary with independently filtered released sites. */
import {useState} from 'react';
import PropTypes from 'prop-types';
import {Link} from 'react-router-dom';
import {Icon} from '../components/icons.jsx';
import {ReadinessTable} from '../components/ReadinessTable.jsx';
import {ProgramPanels, SiteSchematic} from '../components/ProgramPanels.jsx';
import {MODEL, MORNING_SCORE_AT} from '../data/register.js';
import {SCENARIOS} from '../services/sources.js';
import {authorize, INTENT} from '../utils/access.js';
import {FILTERS, formatDate, NO_MATCH, RISK_STYLE, selectPortfolio, sitePath} from '../utils/portfolio.js';

const HARBOR = ['NRO-W-1842', 'Harbor Point power blocker'];
const FOCUS = {
  A: [['NRO-W-1847', 'Civic Center dispatch'], HARBOR],
  B: [['NRO-W-1851', 'Lakeside stale permit'], ['NRO-W-1855', 'Market DAS material conflict'],
    ['NRO-W-1860', 'Hillcrest low confidence'], HARBOR],
};

/** Display full program KPIs, exception shortcuts and the released-site register. */
export default function Portfolio({board, actor, query}) {
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
          <p className="meta mt-1">{model.total} sites on the board · {program.design.length} still in design · scored {formatDate(MORNING_SCORE_AT, true)} with {MODEL}.</p>
        </div>
        {(authorize(actor, INTENT.evidence) || authorize(actor, INTENT.approve)) && (
          <Link className="btn btn-primary" to={sitePath('NRO-W-1842')}>
            Review Harbor Point
            <Icon name="arrow" />
          </Link>
        )}
      </section>
      {FOCUS[board.scenario] && (
        <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1" aria-label="Workshop focus">
          <h2 className="meta font-semibold">{SCENARIOS[board.scenario]} workshop focus</h2>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-meta">
            {FOCUS[board.scenario].map(([id, label]) => (
              <li key={id}>
                <Link className="font-medium text-teal-ink underline-offset-4 hover:underline" to={sitePath(id)}>{label}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
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
              <p className="meta">Share of the board at green.</p>
            </div>
            <svg role="img" aria-label={`14-day Green share trend: ${program.trend.map(entry => `${entry.greenShare}%`).join(', ')}`} viewBox="0 0 130 40" className="h-12 w-32 shrink-0">
              <path aria-hidden="true" d="M0 34H130M0 10H130" className="stroke-line" />
              <polyline points={program.trend.map((entry, index) => `${2 + index * 9.7},${82 - entry.greenShare}`).join(' ')} className="fill-none stroke-teal" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          <div aria-hidden="true" className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
            {Object.entries(model.risk).map(([risk, value]) => value > 0 && <span key={risk} className={RISK_STYLE[risk].fill} style={{flexGrow: value}} />)}
          </div>
          <ul className="mt-2 flex flex-wrap gap-3">
            {Object.entries(model.risk).map(([risk, value]) => (
              <li key={risk} className={`inline-flex items-center gap-1 text-meta ${RISK_STYLE[risk].ink}`}>
                <Icon name={risk} />
                {risk} {value}
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-4" aria-labelledby="exception-title">
          <h2 id="exception-title" className="text-base font-semibold text-ink">Exceptions</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {model.exceptions.map(group => (
              <li key={group.id} className="min-w-0">
                <button type="button" className={`rounded-control border px-2 py-1 font-semibold ${exception === group.id ? 'border-teal bg-green-wash text-teal-ink' : 'border-transparent text-ink hover:bg-surface'}`} aria-pressed={exception === group.id} onClick={() => { setChip('All'); setException(exception === group.id ? null : group.id); }}>{group.sites.length} {group.label}</button>
                <ul className="flex flex-wrap gap-x-2 px-2 text-meta">
                  {group.sites.map(site => (
                    <li key={site.id}>
                      <Link className="text-teal-ink underline-offset-4 hover:underline" to={sitePath(site.id)}>{site.name}</Link>
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
            <button key={label} type="button" aria-pressed={!exception && chip === label} className={`rounded-full border px-3 py-1 text-meta font-semibold ${!exception && chip === label ? 'border-teal bg-green-wash text-teal-ink' : 'border-line bg-card text-ink hover:border-muted'}`} onClick={() => { setChip(label); setException(null); }}>{label}</button>
          ))}
        </div>
        <p role="status" className="meta">Showing {model.visible.length} of {model.total} sites.{!model.visible.length && query.trim() ? ` ${NO_MATCH}` : ''}</p>
      </section>
      <div className="grid items-start gap-4 min-[1560px]:grid-cols-[minmax(0,1fr)_230px]">
        <ReadinessTable board={board} sites={model.visible} sort={sort} onSort={changeSort} />
        <SiteSchematic sites={model.visible} />
      </div>
      <ProgramPanels board={board} />
    </div>
  );
}

Portfolio.propTypes = {board: PropTypes.object.isRequired, actor: PropTypes.object.isRequired, query: PropTypes.string.isRequired};
