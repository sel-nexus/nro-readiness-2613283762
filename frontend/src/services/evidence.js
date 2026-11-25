/** Update working evidence and attach fixture text through guarded board commits. */
import {UPLOADS} from '../data/program.js';
import {BOARD_AT, ROW_ORDER} from '../data/register.js';
import {authorize, INTENT} from '../utils/access.js';
import {civilMillis, deriveReadiness, rowQuality} from '../utils/readiness.js';

export const STATUSES = Object.freeze(['Ready', 'Not Ready', 'In progress', 'Unavailable']);
export const EXTRACTION_FAILED = 'Couldn’t read text from this file. Upload a text-based PDF or a clear photo of the page.';
const TYPES = Object.freeze({pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg'});
const LABEL_LIMIT = 120;
const NOTE_LIMIT = 1000;
const SHA256_ROUNDS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Rotate a word right without dropping its low bits. */
const rotateRight = (word, bits) => (word >>> bits) | (word << (32 - bits));

/** Hash a normalized receipt tuple using synchronous SHA-256 (FIPS 180-4).
 *
 * Args:
 *   fields: Ordered committed-intent values, without session credentials.
 * Returns:
 *   Lowercase hexadecimal digest; the serialized tuple is never persisted as the key.
 * Notes:
 *   The guarded storage transaction and both evidence handlers are synchronous.
 */
function receiptDigest(fields) {
  const bytes = new TextEncoder().encode(JSON.stringify(fields));
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const blocks = new DataView(padded.buffer);
  blocks.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  blocks.setUint32(padded.length - 4, bytes.length * 8);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = blocks.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const x = words[i - 15];
      const y = words[i - 2];
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[i] = words[i - 16] + s0 + words[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i += 1) {
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const t1 = h + s1 + ((e & f) ^ (~e & g)) + SHA256_ROUNDS[i] + words[i];
      const t2 = s0 + ((a & b) ^ (a & c) ^ (b & c));
      [a, b, c, d, e, f, g, h] = [(t1 + t2) | 0, a, b, c, (d + t1) | 0, e, f, g];
    }
    [a, b, c, d, e, f, g, h].forEach((word, i) => { state[i] += word; });
  }
  return Array.from(state, word => word.toString(16).padStart(8, '0')).join('');
}

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

/** Preserve the live fence and bind the receipt to the normalized operation. */
function evidenceCommand(input, intent, payload) {
  const {commandId, siteId, expectedSiteRev, expectedGeneration, expectedSessionEpoch, expectedSessionToken, row} = input;
  return {commandId, siteId, expectedSiteRev, expectedGeneration, expectedSessionEpoch, expectedSessionToken,
    intentKey: `${intent}:sha256:${receiptDigest([siteId, row, expectedSiteRev, ...payload])}`,
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
  if ([...source].length > LABEL_LIMIT || [...note].length > NOTE_LIMIT) {
    return commandError('BAD_INPUT', 'Use at most 120 characters for the source and 1000 for the note.');
  }
  if (sourceAt === null ? status !== 'Unavailable' : !Number.isFinite(civilMillis(sourceAt)) || civilMillis(sourceAt) > civilMillis(BOARD_AT)) {
    return commandError('BAD_INPUT', 'Provide a valid evidence time no later than 12 May 2026 09:40, or leave it blank only for Unavailable.');
  }
  return store.commit(evidenceCommand(input, INTENT.evidence, [status, source, sourceAt, note || null]), (board, actor) => {
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
  const {row, fileName: rawName, sizeBytes, mediaType = ''} = input;
  const fileName = typeof rawName === 'string' ? rawName.trim() : '';
  if ([...fileName].length > LABEL_LIMIT) return commandError('BAD_FILE', 'Use a file name with at most 120 characters.');
  const extension = typeof rawName === 'string' && !/[\\/\u0000-\u001f]/.test(rawName) ? /\.(pdf|png|jpg)$/i.exec(fileName)?.[1].toLowerCase() : null;
  const type = TYPES[extension];
  if (!type || typeof mediaType !== 'string' || (mediaType && mediaType.toLowerCase() !== type)
    || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return commandError('BAD_FILE', 'Choose a PDF, PNG or JPG file with a matching file type.');
  if (typeof input.siteId !== 'string' || !Number.isSafeInteger(input.expectedSiteRev) || !ROW_ORDER.includes(row)) return commandError('BAD_INPUT', 'Choose an evidence row.');
  // Exact input spelling controls fixture extraction even when the stored names match.
  const fixture = UPLOADS.doc_1842_power;
  const extractedText = rawName === fixture.fileName ? fixture.extractedText : null;
  const extractionState = extractedText ? 'available' : 'failed';
  return store.commit(evidenceCommand(input, INTENT.attach, [fileName, sizeBytes, type, extractionState]), (board, actor) => {
    const site = board.sites[input.siteId];
    if (site.lifecycle !== 'open') return commandError('INAPPLICABLE', 'Historical evidence cannot be edited.');
    const id = `doc_${input.commandId}`;
    if (Object.hasOwn(board.uploads, id)) return commandError('ID_CONFLICT', 'This attachment command has already been used.');
    const eventId = `ev_${input.commandId}`;

    const doc = {id, siteId: site.id, row, fileName, sizeBytes, mediaType: type, addedAt: BOARD_AT, addedBy: actor.id,
      extractedText, extractionState};
    const audit = appendEvent(board.audit, {id: eventId, siteId: site.id, at: BOARD_AT, actorKind: 'person', actorId: actor.id,
      verb: 'Document added', row, uploadId: id, detail: fileName});
    return {writes: {sites: {...board.sites, [site.id]: {...site, rev: site.rev + 1}}, uploads: {...board.uploads, [id]: doc}, audit},
      result: {siteRev: site.rev + 1, uploadId: id, extraction: extractionState, eventId}};
  });
}
