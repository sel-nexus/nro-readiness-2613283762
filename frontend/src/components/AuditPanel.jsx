/** Expand recorded audit facts and archived assessment inputs, never working rows. */
import PropTypes from 'prop-types';
import {siteAudit} from '../services/decisions.js';
import {formatDate, personName} from '../utils/portfolio.js';

const ACTORS = {system: 'NRO Readiness', ddl: 'DDL sync'};

/** Display a percent without treating zero as missing. */
const percent = value => value == null ? 'Unavailable' : `${value}%`;

/** Render one site's history newest first using an explicit display allowlist. */
export function AuditPanel({board, site}) {
  const events = siteAudit(board, site.id);
  return (
    <section className="card space-y-3 p-4" aria-labelledby="audit-heading">
      <h2 id="audit-heading">Audit</h2>
      {!events.length && <p>No events are recorded for this site.</p>}
      <ol className="divide-y divide-line">
        {events.map(event => {
          const snapshot = board.audit.snapshots[event.snapshotId];
          const decision = site.decisions.find(item => item.id === event.decisionId);
          const approval = event.verb === 'Approval' || event.verb === 'Override';
          const name = ACTORS[event.actorId] ?? (event.actorKind === 'model' ? 'Assessment model' : personName(board, event.actorId));
          return (
            <li key={event.id} className="py-2">
              <details>
                <summary className="cursor-pointer py-1 font-medium">{event.verb} · {formatDate(event.at, true)} · {name}</summary>
                <div className="space-y-2 pb-2 pl-4">
                  {event.verb !== 'Scored' && <p className="break-words">{event.detail}</p>}
                  {event.verb === 'Approval denied' ? (
                    <p>Actor ID: {event.actorId} · Attempted action: {event.attemptedVerb} · Reason: {event.reasonCode}</p>
                  ) : (
                    <>
                      <dl className="grid gap-2 sm:grid-cols-2">
                        {approval && (
                          <>
                            <div>
                              <dt className="meta">Downstream workflow ID</dt>
                              <dd>{event.workflowId ?? decision?.workflowId ?? 'Not queued'}</dd>
                            </div>
                            <div>
                              <dt className="meta">Model version</dt>
                              <dd>{event.model ?? 'Unavailable'}</dd>
                            </div>
                            <div>
                              <dt className="meta">Decided by</dt>
                              <dd>{name}</dd>
                            </div>
                            <div>
                              <dt className="meta">Decision time</dt>
                              <dd><time dateTime={event.at}>{formatDate(event.at, true)}</time></dd>
                            </div>
                          </>
                        )}
                        <div>
                          <dt className="meta">Input snapshot ID</dt>
                          <dd>{event.snapshotId ?? decision?.assessmentRef ?? 'Unavailable'}</dd>
                        </div>
                        <div>
                          <dt className="meta">Output · Confidence</dt>
                          <dd>{percent(event.output)} · {percent(event.confidence)}</dd>
                        </div>
                        {decision && (
                          <div>
                            <dt className="meta">Decision</dt>
                            <dd>{decision.disposition ?? `Approved — ${decision.scope.kind}`}</dd>
                          </div>
                        )}
                        {event.executionEvidenceRev != null && (
                          <div>
                            <dt className="meta">Working evidence revision at execution</dt>
                            <dd>{event.executionEvidenceRev}</dd>
                          </div>
                        )}
                      </dl>
                      {(event.rationale ?? decision?.rationale) && <p className="break-words">Rationale: {event.rationale ?? decision.rationale}</p>}
                      {snapshot && (
                        <details className="border-t border-line pt-1">
                          <summary className="cursor-pointer py-1 font-medium">Assessed prerequisite snapshot</summary>
                          <ul className="space-y-1 pl-4">
                            {snapshot.rows.map(row => (
                              <li key={row.row}>
                                <p>{row.row} · {row.status} · {row.quality} · {row.source}</p>
                                {row.observations.length > 1 && row.observations.map((observation, index) => (
                                  <p key={index} className="meta pl-3">
                                    {observation.source} · {observation.status} · {observation.sourceAt
                                      ? formatDate(observation.sourceAt, true)
                                      : 'No timestamp'}
                                  </p>
                                ))}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

AuditPanel.propTypes = {board: PropTypes.object.isRequired, site: PropTypes.object.isRequired};
