/** Render the released-site register with operable sort headings and site links. */
import PropTypes from 'prop-types';
import {Link, useNavigate} from 'react-router-dom';
import {Icon} from './icons.jsx';
import {formatDate, personName, relativeDay, RISK_STYLE, sitePath} from '../utils/portfolio.js';
import {MORNING_SCORE_AT} from '../data/register.js';

const columns = [['Site'], ['Neighborhood'], ['Planned', 'planned'], ['Readiness', 'readiness'], ['Confidence'], ['Risk', 'risk'], ['Top blocker'], ['Disposition'], ['Next owner']];

/** Navigate on a plain row click while preserving links, text selection and modified clicks. */
function rowClick(event, navigate, id) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
    || event.target.closest('a, button') || window.getSelection()?.toString()) return;
  navigate(sitePath(id));
}

/** Render visible rows in their selected order without changing the board. */
export function ReadinessTable({board, sites, sort, onSort}) {
  const navigate = useNavigate();
  return (
    <section className="card min-w-0" aria-labelledby="readiness-title">
      <h2 id="readiness-title" className="px-4 pt-4 text-base font-semibold text-ink">Site readiness</h2>
      <div className="scroll-table mt-3 overflow-x-auto" role="region" aria-label="Scrollable site readiness register" tabIndex={0}>
        <table className="w-full min-w-[860px] border-collapse text-left">
          <caption className="sr-only">Site readiness register</caption>
          <thead className="bg-surface text-meta text-muted">
            <tr>
              {columns.map(([label, key]) => (
                <th key={label} scope="col" className="px-3 py-2 font-semibold"
                  aria-sort={key ? (sort?.key === key ? sort.direction : (!sort && key === 'risk' ? 'ascending' : 'none')) : undefined}>
                  {key ? (
                    <button className="inline-flex min-h-6 items-center gap-1 rounded-sm hover:underline" type="button" onClick={() => onSort(key)}>
                      {label}
                      <Icon name={sort?.key === key ? (sort.direction === 'descending' ? 'down' : 'up') : !sort && key === 'risk' ? 'up' : 'chevron'} />
                    </button>
                  ) : label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sites.map(site => {
              const {assessment, lifecycle, plan, risk} = site;
              return (
                <tr className={`cursor-pointer border-t border-line align-middle ${RISK_STYLE[risk].row}`} key={site.id}
                  onClick={event => rowClick(event, navigate, site.id)}>
                  <th scope="row" className="bg-transparent px-3 py-2 font-semibold">
                    <Link to={sitePath(site.id)} className="block whitespace-nowrap text-ink underline-offset-4 hover:underline">{site.name}</Link>
                    <span className="meta whitespace-nowrap font-normal">{site.id}</span>
                  </th>
                  <td className="px-3 py-2">{site.neighborhood}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatDate(lifecycle === 'on_air' ? plan.closedAt : plan.plannedDay)}
                    {lifecycle === 'on_air'
                      ? <span className="meta block">On air</span>
                      : plan.plannedDay && <span className="meta block">{relativeDay(plan.plannedDay)}</span>}
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    {lifecycle === 'on_air' ? '—' : assessment?.probability == null ? 'Unavailable' : `${assessment.probability}%`}
                  </td>
                  <td className="px-3 py-2">{assessment?.confidence == null ? '—' : `${assessment.confidence}%`}</td>
                  <td className="px-3 py-2">
                    <span className={`badge ${RISK_STYLE[risk].badge}`}>
                      <Icon name={risk} />
                      {risk}
                    </span>
                  </td>
                  <td className="px-3 py-2">{site.blocker}</td>
                  <td className="px-3 py-2">{site.disposition}</td>
                  <td className="whitespace-nowrap px-3 py-2">{personName(board, site.ownerId)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="meta border-t border-line px-4 py-3">Evidence from DPAM, POS, DDL, and ECO. Updated {formatDate(MORNING_SCORE_AT, true)}.</p>
    </section>
  );
}

ReadinessTable.propTypes = {board: PropTypes.object.isRequired, sites: PropTypes.arrayOf(PropTypes.object).isRequired,
  sort: PropTypes.shape({key: PropTypes.string.isRequired, direction: PropTypes.string.isRequired}), onSort: PropTypes.func.isRequired};
