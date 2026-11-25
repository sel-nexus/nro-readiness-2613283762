/** Display working evidence and let authorized Operators replace or attach observations. */
import {useEffect, useRef, useState} from 'react';
import PropTypes from 'prop-types';
import {DIRECTORY} from '../data/people.js';
import {BOARD_AT, ROW_ORDER} from '../data/register.js';
import {attachEvidence, EXTRACTION_FAILED, newCommandId, saveEvidence, siteFence, STATUSES} from '../services/evidence.js';
import {authorize, INTENT} from '../utils/access.js';
import {formatDate, personName} from '../utils/portfolio.js';
import {civilMillis, FRESHNESS_DAYS, RESCORE_NOTICE} from '../utils/readiness.js';

const EDIT_LIMIT = 'Only Operators can update evidence.';
const HISTORY_LIMIT = 'Historical evidence is read-only.';

/** Label source age using calendar days without rounding freshness decisions. */
function freshnessLabel(row, clock) {
  const threshold = FRESHNESS_DAYS[row.row];
  if (!row.sourceAt) return `No age · ${threshold}-day threshold`;
  const age = (civilMillis(`${clock.slice(0, 10)}T00:00:00`) - civilMillis(`${row.sourceAt.slice(0, 10)}T00:00:00`)) / 86400000;
  return `${age} ${age === 1 ? 'day' : 'days'} · ${threshold}-day threshold`;
}

/** Describe only actionable defects without treating disputed readings as verified. */
function problemCopy(site, key, quality) {
  const row = site.rows[key];
  if (key === 'Power' && quality === 'Current' && row.status === 'Not Ready') return 'Power is Not Ready. This site cannot be shown as Ready.';
  if (site.id === 'NRO-W-1851' && key === 'Permit' && quality === 'Stale') return 'Permit evidence is older than 14 days. Confidence has been reduced.';
  if (site.id === 'NRO-W-1855' && key === 'Material' && quality === 'Conflicting') return 'DPAM and DDL disagree on material. Resolve with Omar Shah before relying on this score.';
  if (site.id === 'NRO-W-1872' && key === 'Transmission' && quality === 'Missing') return 'Transmission has no evidence. The probability is Unavailable.';
  return quality !== 'Current' ? `${key} evidence: ${quality}.` : null;
}

/** Collect an explicit observation in a native modal drawer and restore row focus on exit. */
function EvidenceEditor({row, onClose, onSave}) {
  const dialog = useRef(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);

  /** Read labeled inputs and keep an unsuccessful save in the drawer. */
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = form.get('sourceAt');
    const result = onSave({status: form.get('status'), source: form.get('source'), sourceAt: date.length === 16 ? `${date}:00` : date, note: form.get('note')});
    if (!result.ok) setError(result.error.message);
  }

  return (
    <dialog ref={dialog} aria-modal="true" aria-labelledby="edit-evidence-title"
      className="card fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-md p-5"
      onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
        if (event.target !== event.currentTarget) return;
        const {left, right, top, bottom} = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) onClose();
      }}>
      <h2 id="edit-evidence-title" className="text-title">Update {row.row} evidence</h2>
      <form onSubmit={submit} onChange={() => setError(null)} className="mt-4 grid gap-3">
        <label htmlFor="evidence-status">Status</label>
        <select id="evidence-status" name="status" className="field" required defaultValue={row.status}>
          {STATUSES.map(status => <option key={status}>{status}</option>)}
        </select>
        <label htmlFor="evidence-date">Evidence date and time</label>
        <input id="evidence-date" name="sourceAt" type="datetime-local" step="1" max={BOARD_AT} defaultValue={row.sourceAt ?? ''} className="field"
          aria-describedby={error ? 'evidence-error' : 'evidence-date-hint'} aria-invalid={Boolean(error)} />
        <p id="evidence-date-hint" className="meta">Leave blank only when the status is Unavailable.</p>
        <label htmlFor="evidence-source">Source</label>
        <input id="evidence-source" name="source" className="field" required defaultValue={row.source} />
        <label htmlFor="evidence-note">Note (optional)</label>
        <textarea id="evidence-note" name="note" className="field" rows={3} />
        {row.quality === 'Conflicting' && <p className="meta">Save only after reconciling the conflicting observations. This replaces the working row.</p>}
        {error && <p id="evidence-error" role="alert" className="text-red">{error}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary">Save evidence</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}

EvidenceEditor.propTypes = {row: PropTypes.object.isRequired, onClose: PropTypes.func.isRequired, onSave: PropTypes.func.isRequired};

/** Render the six prerequisite rows and their source, ingestion and document details. */
export function EvidenceMatrix({board, site, actor, store, readiness, notify, target}) {
  const [editor, setEditor] = useState(null);
  const trigger = useRef(null);
  const matrix = useRef(null);
  const open = site.lifecycle === 'open';
  const editable = open && authorize(actor, INTENT.evidence);
  const canAttach = open && authorize(actor, INTENT.attach);
  const reason = open ? EDIT_LIMIT : HISTORY_LIMIT;
  const clock = site.plan.closedAt ?? BOARD_AT;
  const documents = Object.values(board.uploads).filter(doc => doc.siteId === site.id);

  useEffect(() => {
    if (!target) return;
    const element = [...matrix.current.querySelectorAll('[data-evidence-target]')].find(node => node.id === target);
    const details = element?.closest('details');
    if (details) details.open = true;
    element?.focus();
  }, [target]);

  /** Dismiss the modal and return focus to the row action. */
  function closeEditor() {
    setEditor(null);
    queueMicrotask(() => trigger.current?.focus());
  }

  /** Save against the revision shown when the drawer was opened. */
  function save(values) {
    const result = saveEvidence(store, {...editor.fence, ...values, row: editor.row.row, commandId: newCommandId()});
    if (result.ok) {
      closeEditor();
      notify('success', 'Evidence updated');
    }
    return result;
  }

  /** Pass only the selected file's label, byte count and declared media type. */
  function attach(event, row) {
    const file = event.currentTarget.files[0];
    event.currentTarget.value = '';
    if (!file) return;
    const result = attachEvidence(store, {...siteFence(store, board, site), commandId: newCommandId(), row,
      fileName: file.name, sizeBytes: file.size, mediaType: file.type});
    notify(result.ok ? 'success' : 'error', result.ok ? 'Document added' : result.error.message);
  }

  return (
    <section className="space-y-3" aria-label="Evidence provenance" ref={matrix}>
      {readiness.evidenceChanged && <p className="rounded-control border border-line bg-card p-3" role="status">{RESCORE_NOTICE}</p>}
      {ROW_ORDER.map(key => {
        const copy = problemCopy(site, key, readiness.quality[key]);
        return copy && <p key={key} className="rounded-control border border-line bg-amber-wash p-3 text-ink">{copy}</p>;
      })}
      {!editable && <p className="meta" id="evidence-update-reason">{reason}</p>}
      <div className="card scroll-table" role="region" aria-label="Scrollable evidence matrix" tabIndex={0}>
        <table className="min-w-[62rem]">
          <caption>Evidence matrix</caption>
          <thead>
            <tr>
              {['Prerequisite', 'Status', 'Quality', 'Source', 'Source time', 'Freshness', 'Owner', 'Update'].map(label => (
                <th key={label} scope="col">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROW_ORDER.map(key => {
              const row = site.rows[key];
              const phone = board.users[row.ownerId]?.phone ?? DIRECTORY[row.ownerId]?.phone;
              const rowDocs = documents.filter(doc => doc.row === key);
              return (
                <tr key={key}>
                  <th scope="row" className="bg-card text-body">
                    <p className="font-semibold text-ink">{key}</p>
                    <p className="meta">{row.flag}</p>
                  </th>
                  <td>{row.status}</td>
                  <td>{readiness.quality[key]}</td>
                  <td>
                    <details>
                      <summary className="cursor-pointer font-medium text-teal-ink" data-evidence-target id={`evidence-${key}`}>{row.source}</summary>
                      <p className="meta mt-1">Ingested: {row.ingestedAt ? formatDate(row.ingestedAt, true) : 'No timestamp'}</p>
                      {row.observations.map((item, i) => (
                        <p key={i}>
                          {item.source} · {item.status} · {item.sourceAt ? formatDate(item.sourceAt, true) : 'No timestamp'}
                          {item.ingestedAt ? ` · Ingested ${formatDate(item.ingestedAt, true)}` : ''}
                        </p>
                      ))}
                      {row.detail && <p className="mt-1">{row.detail}</p>}
                    </details>
                    {rowDocs.map(doc => (
                      <details key={doc.id} className="mt-2 max-w-[25ch] break-words">
                        <summary className="cursor-pointer text-teal-ink" data-evidence-target id={doc.id}>{doc.fileName}</summary>
                        <p className="meta">
                          {doc.sizeBytes.toLocaleString('en-GB')} bytes · {doc.mediaType} · {personName(board, doc.addedBy)} · {formatDate(doc.addedAt, true)}
                        </p>
                        {doc.extractedText && <p className="mt-1">{doc.extractedText}</p>}
                      </details>
                    ))}
                    {rowDocs.some(doc => doc.extractionState === 'failed') && <p className="meta mt-2">{EXTRACTION_FAILED}</p>}
                  </td>
                  <td>{row.sourceAt ? formatDate(row.sourceAt, true) : 'No timestamp'}</td>
                  <td>{freshnessLabel(row, clock)}</td>
                  <td>
                    <p>{personName(board, row.ownerId)}</p>
                    {phone && <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a>}
                  </td>
                  <td>
                    <button type="button" className="btn" aria-label={`Update ${key}`} aria-disabled={!editable}
                      aria-describedby={editable ? undefined : 'evidence-update-reason'} onClick={event => {
                        if (!editable) return;
                        trigger.current = event.currentTarget;
                        setEditor({row, fence: siteFence(store, board, site)});
                      }}>Update</button>
                    {canAttach && (
                      <div className="mt-2">
                        <input className="peer sr-only" type="file" id={`attach-${key}`} aria-label={`Attach evidence to ${key}`}
                          accept=".pdf,.png,.jpg" onChange={event => attach(event, key)} />
                        <label
                          className="cursor-pointer text-teal-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-focus"
                          htmlFor={`attach-${key}`}>
                          Attach evidence
                        </label>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editor && <EvidenceEditor row={editor.row} onSave={save} onClose={closeEditor} />}
    </section>
  );
}

EvidenceMatrix.propTypes = {board: PropTypes.object.isRequired, site: PropTypes.object.isRequired, actor: PropTypes.object.isRequired,
  store: PropTypes.object.isRequired, readiness: PropTypes.object.isRequired, notify: PropTypes.func.isRequired, target: PropTypes.string};
