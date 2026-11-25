/** Update working evidence and attach fixture text through guarded board commits. */
import {UPLOADS} from '../data/program.js';
import {BOARD_AT, ROW_ORDER} from '../data/register.js';
import {authorize, INTENT} from '../utils/access.js';
import {civilMillis, deriveReadiness, rowQuality} from '../utils/readiness.js';

export const STATUSES = Object.freeze(['Ready', 'Not Ready', 'In progress', 'Unavailable']);
export const EXTRACTION_FAILED = 'Couldn’t read text from this file. Upload a text-based PDF or a clear photo of the page.';
const TYPES = Object.freeze({pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg'});

/** Return a safe validation result without including request fields. */
export const commandError = (code, message) => ({ok: false, error: {code, message}});

/** Generate an opaque command identity without putting input data in audit keys. */
export function newCommandId() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Capture the committed context for an edit or delayed attempt. */
export function siteFence(store, board, site) {
  return {siteId: site.id, expectedSiteRev: site.rev, expectedGeneration: board.audit.generation,
    expectedSessionEpoch: store.getSessionEpoch(), expectedSessionToken: board.session?.token ?? null};
}

/** Prepare a protected command from known fence fields only. */
function evidenceCommand(input, intent) {
  const {commandId, siteId, expectedSiteRev, expectedGeneration, expectedSessionEpoch, expectedSessionToken, row} = input;
  return {commandId, siteId, expectedSiteRev, expectedGeneration, expectedSessionEpoch, expectedSessionToken,
    intentKey: `${intent}:${siteId}:${row}:${expectedSiteRev}`,
    authorize: (_board, actor) => authorize(actor, intent)};
}

/** Append one timestamped, attributed event without touching the curated feed. */
export function appendEvent(audit, event) {
  return {...audit, nextSeq: audit.nextSeq + 1, events: [...audit.events, {seq: audit.nextSeq, ...event}]};
}

/** Save an explicit observation; prior model values and snapshot remain untouched.
 *
 * Args:
 *   store: Committed workshop storage adapter.
 *   input: Command identity, site fence, row, status, source, civil sourceAt and optional note.
 * Returns:
 *   Committed revisions and event reference, or a safe failure.
 */
export function saveEvidence(store, input = {}) {
  const {row, status} = input;
  const source = typeof input.source === 'string' ? input.source.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const sourceAt = input.sourceAt === '' ? null : input.sourceAt;
  if (typeof input.siteId !== 'string' || !Number.isSafeInteger(input.expectedSiteRev) || !ROW_ORDER.includes(row) || !STATUSES.includes(status) || !source) {
    return commandError('BAD_INPUT', 'Choose a prerequisite and status, and enter a source.');
  }
  if (sourceAt === null ? status !== 'Unavailable' : !Number.isFinite(civilMillis(sourceAt)) || civilMillis(sourceAt) > civilMillis(BOARD_AT)) {
    return commandError('BAD_INPUT', 'Provide a valid evidence time no later than 12 May 2026 09:40, or leave it blank only for Unavailable.');
  }
  return store.commit(evidenceCommand(input, INTENT.evidence), (board, actor) => {
    const before = board.sites[input.siteId];
    if (before.lifecycle !== 'open') return commandError('INAPPLICABLE', 'Historical evidence cannot be edited.');
    const eventId = `ev_${input.commandId}`;
    const observation = {status, source, sourceAt, ingestedAt: BOARD_AT};
    const replacement = {...before.rows[row], ...observation, quality: 'Current', detail: null, note: note || null,
      observations: sourceAt === null ? [] : [observation]};
    replacement.quality = rowQuality(replacement);
    if (before.rows[row].quality === 'Conflicting' && replacement.quality !== 'Current') {
      return commandError('BAD_INPUT', 'Resolve the source conflict with a current observation before replacing this row.');
    }
    const site = {...before, rows: {...before.rows, [row]: replacement}, rev: before.rev + 1, evidenceRev: before.evidenceRev + 1,
      scoreState: 'needs_rescore', notes: note ? [...before.notes, {id: `note_${input.commandId}`, actorId: actor.id, at: BOARD_AT, text: note}] : before.notes};
    site.risk = deriveReadiness(site, BOARD_AT, board.faults, board.audit.snapshots[site.assessment?.snapshotId]).risk;
    const audit = appendEvent(board.audit, {id: eventId, siteId: site.id, at: BOARD_AT, actorKind: 'person', actorId: actor.id,
      verb: 'Evidence updated', row, detail: `${row}: ${before.rows[row].status} → ${status} · ${replacement.quality}`});
    return {writes: {sites: {...board.sites, [site.id]: site}, audit},
      result: {siteRev: site.rev, evidenceRev: site.evidenceRev, assessmentState: site.scoreState, eventId}};
  });
}

/** Persist file metadata only; never accept or inspect file contents.
 *
 * Args:
 *   store: Committed workshop storage adapter.
 *   input: Command identity, site fence, row, fileName, sizeBytes and mediaType.
 * Returns:
 *   Document and audit references with the fixture extraction state.
 */
export function attachEvidence(store, input = {}) {
  const {row, fileName, sizeBytes, mediaType = ''} = input;
  const extension = typeof fileName === 'string' && !/[\\/\u0000-\u001f]/.test(fileName) ? /\.(pdf|png|jpg)$/i.exec(fileName)?.[1].toLowerCase() : null;
  const type = TYPES[extension];
  if (!type || typeof mediaType !== 'string' || (mediaType && mediaType.toLowerCase() !== type)
    || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return commandError('BAD_FILE', 'Choose a PDF, PNG or JPG file with a matching file type.');
  if (typeof input.siteId !== 'string' || !Number.isSafeInteger(input.expectedSiteRev) || !ROW_ORDER.includes(row)) return commandError('BAD_INPUT', 'Choose an evidence row.');
  return store.commit(evidenceCommand(input, INTENT.attach), (board, actor) => {
    const site = board.sites[input.siteId];
    if (site.lifecycle !== 'open') return commandError('INAPPLICABLE', 'Historical evidence cannot be edited.');
    const id = `doc_${input.commandId}`;
    if (Object.hasOwn(board.uploads, id)) return commandError('ID_CONFLICT', 'This attachment command has already been used.');
    const eventId = `ev_${input.commandId}`;
    const fixture = UPLOADS.doc_1842_power;
    const extractedText = fileName === fixture.fileName ? fixture.extractedText : null;
    const extractionState = extractedText ? 'available' : 'failed';
    const doc = {id, siteId: site.id, row, fileName, sizeBytes, mediaType: type, addedAt: BOARD_AT, addedBy: actor.id,
      extractedText, extractionState};
    const audit = appendEvent(board.audit, {id: eventId, siteId: site.id, at: BOARD_AT, actorKind: 'person', actorId: actor.id,
      verb: 'Document added', row, uploadId: id, detail: fileName});
    return {writes: {sites: {...board.sites, [site.id]: {...site, rev: site.rev + 1}}, uploads: {...board.uploads, [id]: doc}, audit},
      result: {siteRev: site.rev + 1, uploadId: id, extraction: extractionState, eventId}};
  });
}
