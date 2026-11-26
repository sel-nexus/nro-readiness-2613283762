/** Persist and recover one workshop tab's board without exposing incomplete transactions. */
import {BOARD_KEYS, counter, validateAccess, validateBoard} from '../data/baseline.js';
import {DIRECTORY, freezeTree, PERSON} from '../data/people.js';
import {DEFAULT_PROGRAM, makeProgramBoard, PROGRAMS} from '../data/programs.js';
import {ROW_ORDER, SUPPLIERS} from '../data/register.js';
import {DEFAULT_THRESHOLDS, validThresholds} from './readiness.js';

export const STORAGE_PREFIX = 'nro.demo.';
export const SCHEMA_VERSION = 1;
const KEYS = ['users', 'session', ...BOARD_KEYS];
const PENDING = 'pendingCommit';
const CHANGED = 'Board or access changed. Review and confirm again.';

/** Wrap a successful operation without carrying private request fields. */
const ok = data => ({ok: true, data});
/** Construct a safe, displayable failure envelope. */
const fail = (code, message) => ({ok: false, error: {code, message}});
/** Explain that no board is available until storage is recovered. */
const recoveryError = () => fail('RECOVERY_REQUIRED', 'Board unavailable. Ask the cluster administrator to restore the morning board.');
/** Explain that a write was not confirmed. */
const writeError = () => fail('STORAGE_WRITE', 'No changes confirmed.');
/** Reject invalid input without logging it. */
const invalid = () => fail('BAD_INPUT', 'Invalid board command.');
/** Apply the storage namespace. */
const keyOf = key => `${STORAGE_PREFIX}${key}`;
/** Identify an explicit command without interpreting it as an object key. */
const validId = id => typeof id === 'string' && id.trim().length > 0;
/** Retain historical West Metro keys while qualifying all other board keys. */
const boardKeyOf = (programId, key) => keyOf(programId === DEFAULT_PROGRAM ? key : `program.${programId}.${key}`);

/** Decode one versioned record; absence is handled by initialization, not here. */
function decode(raw) {
  const envelope = JSON.parse(raw);
  if (envelope?.schemaVersion !== SCHEMA_VERSION || !Object.hasOwn(envelope, 'value')) throw new Error('Unsupported storage record.');
  return envelope.value;
}

/** Validate a pending marker before acting on its key names or values. */
function parseJournal(raw, allowed = KEYS) {
  const journal = JSON.parse(raw);
  if (journal?.schemaVersion !== SCHEMA_VERSION || !validId(journal.commandId)
    || !Array.isArray(journal.keys) || !journal.keys.length || new Set(journal.keys).size !== journal.keys.length
    || !journal.keys.every(key => allowed.includes(key)) || !journal.prior || Array.isArray(journal.prior)
    || Object.keys(journal.prior).length !== journal.keys.length
    || !journal.keys.every(key => Object.hasOwn(journal.prior, key) && (journal.prior[key] === null || typeof journal.prior[key] === 'string'))
    || (journal.mode !== 'rollback' && (journal.mode !== 'restore' || !counter(journal.targetGeneration)
      || journal.targetGeneration < 1 || journal.keys.length !== BOARD_KEYS.length || !BOARD_KEYS.every(key => journal.keys.includes(key))))
    || (journal.targets !== undefined && (journal.mode !== 'restore' || allowed !== KEYS || !journal.targets
      || Array.isArray(journal.targets) || typeof journal.targets !== 'object'
      || !Object.entries(journal.targets).every(([id, target]) => id !== DEFAULT_PROGRAM && Object.hasOwn(PROGRAMS, id) && counter(target) && target > 0)))) {
    throw new Error('Invalid pending board transaction.');
  }
  return journal;
}

/** Encode a JSON write set, with null session explicitly removing its key. */
function encode(key, value) {
  if (key === 'session' && value === null) return null;
  return stringify({schemaVersion: SCHEMA_VERSION, value});
}

/** Reject values JSON would silently omit or convert before recording a transaction. */
function stringify(value) {
  return JSON.stringify(value, (_key, entry) => {
    if (['undefined', 'function', 'symbol'].includes(typeof entry) || (typeof entry === 'number' && !Number.isFinite(entry))) {
      throw new Error('Unsupported transaction value.');
    }
    return entry;
  });
}

/** Preserve appended audit data across ordinary commits, including receipt identity. */
function historyUnchanged(before, after) {
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  return after.generation === before.generation && after.nextSeq >= before.nextSeq && after.replaySeq >= before.replaySeq
    && before.events.every((event, index) => equal(event, after.events[index]))
    && ['snapshots', 'receipts'].every(key => Object.entries(before[key]).every(([id, value]) => equal(value, after[key][id])));
}

/** Validate a scoped board before exposing it, including every local record reference. */
function validateScoped(board, seed) {
  const {sites, program, uploads, audit, faults, scenario} = board;
  validateAccess(board.users, board.session);
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const check = ok => { if (!ok) throw new Error('Invalid program records.'); };
  const hasSite = id => Object.hasOwn(sites, id);
  const hasActor = id => Object.hasOwn(board.users, id) || Object.hasOwn(DIRECTORY, id);
  const atSite = (id, siteId) => typeof id === 'string' && audit.snapshots[id]?.siteId === siteId;
  const planOk = plan => record(plan) && Object.hasOwn(SUPPLIERS, plan.supplierId)
    && SUPPLIERS[plan.supplierId].agreementId === plan.agreementId;
  const rowOk = (row, key) => record(row) && row.row === key
    && ['Ready', 'Not Ready', 'In progress', 'Unavailable'].includes(row.status)
    && ['Current', 'Stale', 'Conflicting', 'Missing'].includes(row.quality)
    && typeof row.source === 'string' && Array.isArray(row.observations)
    && (row.quality !== 'Missing' || (row.status === 'Unavailable' && row.sourceAt === null))
    && (row.quality !== 'Conflicting' || row.observations.length >= 2);
  check([sites, program, audit, uploads, faults].every(record) && ['A', 'B', 'C', 'D'].includes(scenario));
  check(program.cluster === seed.program.cluster && Object.keys(sites).length === Object.keys(seed.sites).length
    && Object.keys(seed.sites).every(hasSite));
  check(['crew', 'failures', 'design', 'notices', 'morning', 'trend', 'visitsAtStake'].every(key => Array.isArray(program[key]))
    && [program.eco, program.sources, program.lastScore, audit.snapshots, audit.receipts].every(record)
    && Array.isArray(audit.events) && [audit.generation, audit.nextSeq, audit.replaySeq, faults.rev, faults.retryFailuresRemaining].every(counter)
    && [null, 'Up', 'Down'].includes(faults.ddlOverride)
    && ['assessmentDown', 'scenarioAssessmentDown', 'scenarioDdlDown', 'forceLowConfidence'].every(key => typeof faults[key] === 'boolean'));
  check(Object.keys(seed.program.sources).every(key => program.sources[key]?.sourceId === key)
    && JSON.stringify(program.design) === JSON.stringify(seed.program.design));
  const crew = new Map(program.crew.map(item => [item.id, item]));
  check(crew.size === program.crew.length && program.crew.every(item => counter(item.rev)
    && (item.siteId === null || hasSite(item.siteId)) && (item.leadId === null || hasActor(item.leadId))
    && (item.size === null || counter(item.size))));
  const decisions = new Map();
  for (const [id, site] of Object.entries(sites)) {
    check(site.id === id && planOk(site.plan) && [site.rev, site.planRev, site.evidenceRev].every(counter)
      && ['open', 'dispatched', 'on_air'].includes(site.lifecycle) && typeof site.holdActive === 'boolean'
      && (site.ownerId === null || hasActor(site.ownerId)) && record(site.rows) && Object.keys(site.rows).join() === ROW_ORDER.join()
      && ROW_ORDER.every(key => rowOk(site.rows[key], key) && hasActor(site.rows[key].ownerId))
      && [site.notes, site.decisions, site.executions].every(Array.isArray));
    const score = site.assessment;
    check(score === null || (score.siteId === id && atSite(score.snapshotId, id) && counter(score.confidence) && score.confidence <= 100
      && (score.probability === null || (counter(score.probability) && score.probability <= 100))));
    check(site.notes.every(note => hasActor(note.actorId)) && (site.proposal == null || site.proposal.ownerId === null || hasActor(site.proposal.ownerId)));
    for (const item of site.decisions) {
      check(!decisions.has(item.id) && hasActor(item.actorId) && planOk(item.before) && planOk(item.after)
        && (item.assessmentRef == null || atSite(item.assessmentRef, id)));
      decisions.set(item.id, id);
    }
    check(site.executions.every(item => hasActor(item.actorId) && crew.get(item.assignmentId)?.siteId === id
      && (item.approvalId == null || decisions.get(item.approvalId) === id) && (item.snapshotId == null || atSite(item.snapshotId, id))));
  }
  check(Object.entries(audit.snapshots).every(([id, snap]) => snap.id === id && hasSite(snap.siteId) && planOk(snap.plan)
    && counter(snap.planRev) && counter(snap.evidenceRev) && Array.isArray(snap.rows) && snap.rows.length === ROW_ORDER.length
    && snap.rows.every((row, index) => rowOk(row, ROW_ORDER[index]))));
  const ids = new Set();
  let last = 0;
  for (const event of audit.events) {
    check(typeof event.id === 'string' && !ids.has(event.id) && counter(event.seq) && event.seq > last
      && (event.siteId == null || hasSite(event.siteId)) && (event.snapshotId == null || atSite(event.snapshotId, event.siteId))
      && (event.decisionId == null || decisions.get(event.decisionId) === event.siteId)
      && (event.workflowId == null || program.eco[event.workflowId]?.siteId === event.siteId));
    ids.add(event.id);
    last = event.seq;
  }
  check(audit.nextSeq > last && Object.values(audit.receipts).every(item => record(item) && Object.hasOwn(board.users, item.actorId)
    && typeof item.intentKey === 'string' && record(item.safeResult) && typeof item.safeResult.ok === 'boolean'));
  check(Object.entries(uploads).every(([id, doc]) => doc.id === id && hasSite(doc.siteId) && ROW_ORDER.includes(doc.row)
    && counter(doc.sizeBytes) && hasActor(doc.addedBy)));
  check(Object.entries(program.eco).every(([id, item]) => item.id === id && decisions.get(item.decisionId) === item.siteId)
    && program.visitsAtStake.every(hasSite) && [...program.failures, ...program.morning].every(item => hasSite(item.siteId))
    && program.notices.every(item => item.siteId === null || hasSite(item.siteId)) && atSite(program.lastScore.snapshotId, program.lastScore.siteId));
}

/** Create a single-tab store using the Storage getItem/setItem/removeItem contract.
 *
 * Args:
 *   storage: The workshop origin's local storage or an injected synchronous adapter.
 *   programId: A known program; secondary stores read but never write common access.
 * Returns:
 *   Bootstrap/recovery, stable snapshot subscription, transaction and reset methods.
 * Notes:
 *   Domain services authorize specific intents in their synchronous builder, using
 *   the live actor supplied by the store. Storage is not a production security boundary.
 */
export function createStore(storage, programId = DEFAULT_PROGRAM) {
  const scoped = programId !== DEFAULT_PROGRAM;
  const seed = makeProgramBoard(programId);
  const makeSeed = () => structuredClone(seed);
  /** Allow historical records without settings; reject invalid settings when present. */
  function validate(board) {
    if (scoped) validateScoped(board, seed);
    else validateBoard(board);
    if (Object.hasOwn(board.program, 'thresholds') && !validThresholds(board.program.thresholds)) throw new Error('Invalid thresholds.');
  }
  /** Resolve board keys and journals separately; access retains its historical prefix. */
  const storageKey = key => ['users', 'session'].includes(key) ? keyOf(key) : boardKeyOf(programId, key);
  const journalKeys = scoped ? BOARD_KEYS : KEYS;
  let snapshot = null;
  let generation = null;
  let sessionEpoch = 0;
  let busy = false;
  const listeners = new Set();

  /** Apply a raw value exactly; null means the original key did not exist. */
  function write(key, raw) {
    if (raw === null) storage.removeItem(storageKey(key));
    else storage.setItem(storageKey(key), raw);
  }

  /** Read the specified keys without inventing values for unavailable records. */
  function read(keys) {
    return Object.fromEntries(keys.map(key => [key, storage.getItem(storageKey(key))]));
  }

  /** Publish only validated boards and defer notification until the guard is released. */
  function publish(board) {
    if (board) {
      if (snapshot && JSON.stringify(snapshot) === JSON.stringify(board)) return;
      if (snapshot?.session?.token !== board.session?.token) sessionEpoch += 1;
      generation = board.audit.generation;
    }
    snapshot = board === null ? null : freezeTree(board);
  }

  /** Serialize operations and isolate subscriber exceptions from write results. */
  function guarded(operation) {
    if (busy) return fail('STALE_INTENT', CHANGED);
    const before = snapshot;
    busy = true;
    let result;
    try {
      result = operation();
    } catch {
      publish(null);
      result = recoveryError();
    } finally {
      busy = false;
    }
    if (snapshot !== before) for (const listener of [...listeners]) {
      try { listener(); } catch (error) { globalThis.reportError?.(error); }
    }
    return result;
  }

  /** Replay exact previous raw values, leaving the marker in place on failure. */
  function rollback(journal) {
    for (const key of journal.keys) write(key, journal.prior[key]);
    write(PENDING, null);
  }

  /** Roll forward an explicitly authorized restore using only the board keys. */
  function finishRestore(targetGeneration, targets = {}) {
    const seed = makeSeed();
    const access = read(['users', 'session']);
    seed.users = decode(access.users);
    seed.session = access.session === null ? null : decode(access.session);
    seed.audit.generation = targetGeneration;
    validate(seed);
    for (const key of BOARD_KEYS) write(key, encode(key, seed[key]));
    for (const [id, target] of Object.entries(targets)) {
      const next = makeProgramBoard(id);
      next.audit.generation = target;
      for (const key of BOARD_KEYS) storage.setItem(boardKeyOf(id, key), encode(key, next[key]));
      storage.removeItem(boardKeyOf(id, PENDING));
    }
    write(PENDING, null);
    return seed;
  }

  /** Resolve any journal before attempting to consume the current board. */
  function replayPending() {
    const raw = storage.getItem(storageKey(PENDING));
    if (raw === null) return;
    const journal = parseJournal(raw, journalKeys);
    if (journal.mode === 'restore') finishRestore(journal.targetGeneration, journal.targets);
    else rollback(journal);
  }

  /** Persist complete encoded writes, rolling back before returning any failure. */
  function persist(commandId, writes, prior) {
    const keys = Object.keys(writes);
    if (!keys.length) return ok(null);
    const journal = {schemaVersion: SCHEMA_VERSION, commandId, mode: 'rollback', keys,
      prior: Object.fromEntries(keys.map(key => [key, prior[key]])), targetGeneration: null};
    const marker = JSON.stringify(journal);
    let markerWritten = false;
    try {
      write(PENDING, marker);
      markerWritten = true;
      for (const key of keys) write(key, writes[key]);
      write(PENDING, null);
      return ok(null);
    } catch {
      try {
        const currentMarker = storage.getItem(storageKey(PENDING));
        if (currentMarker === marker || (markerWritten && currentMarker === null)) {
          if (currentMarker === null) write(PENDING, marker);
          rollback(journal);
        } else if (currentMarker !== null) {
          publish(null);
          return recoveryError();
        }
        return writeError();
      } catch {
        publish(null);
        return recoveryError();
      }
    }
  }

  /** Load validated state, seeding absent records only if the merged board is safe. */
  function load() {
    if (scoped && storage.getItem(boardKeyOf(DEFAULT_PROGRAM, PENDING)) !== null) {
      publish(null);
      return recoveryError();
    }
    replayPending();
    const raw = read(KEYS);
    const board = makeSeed();
    const absent = {};
    for (const key of KEYS) {
      if (raw[key] !== null) board[key] = decode(raw[key]);
      else if (key === 'users' && scoped) return recoveryError();
      else if (key !== 'session') absent[key] = encode(key, board[key]);
    }
    if (BOARD_KEYS.some(key => Object.hasOwn(absent, key))) {
      const seed = makeSeed();
      // A changed adopted board cannot silently regain a missing mutable record.
      if (BOARD_KEYS.some(key => raw[key] !== null && JSON.stringify(board[key]) !== JSON.stringify(seed[key]))) {
        publish(null);
        return recoveryError();
      }
    }
    validate(board);
    const result = persist('bootstrap', absent, raw);
    if (!result.ok) return result;
    publish(board);
    return ok(snapshot);
  }

  /** Initialize or reopen the board; only absent, compatible seed keys are filled. */
  function bootstrap() { return guarded(load); }

  /** Recover a pending journal and publish the complete validated result. */
  function recover() { return guarded(load); }

  /** Return the last complete frozen board, or null before load or during recovery lockout. */
  function getSnapshot() { return snapshot; }

  /** Return the in-memory session fence for an impending confirmation. */
  function getSessionEpoch() { return sessionEpoch; }

  /** Subscribe to committed snapshot changes and return an unsubscribe callback. */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** Run one synchronous domain command against a fresh, frozen board.
   *
   * Args:
   *   command: {commandId, intentKey?, authorize?, expectedGeneration?, expectedSessionToken?,
   *     expectedSessionEpoch?, siteId?, expectedSiteRev?, assignmentId?, assignmentRev?, sessionOnly?}.
   *     intentKey is a normalized safe identity, never raw credentials or rationale.
   *     If provided, authorize(board, actor) returns true or a failure Result and
   *     runs before receipt replay; the builder enforces domain write policy.
   *   build: (board, actor) => {ok:true,data:{writes,result?}} or a failure Result;
   *     alternatively {writes,result?}, or {build: callback}. Actor is null if signed
   *     out; sessionOnly permits only the session key, including removal with null.
   *     An explicit failure Result in result can be durably recorded for an audited denial.
   * Returns:
   *   The safe command Result after journal removal; a matching authorized receipt
   *   is replayed without a new write. Footprint is limited to board keys or session.
   */
  function commit(command, build) {
    return guarded(() => {
      const builder = typeof build === 'function' ? build : build?.build;
      if (scoped && command?.sessionOnly) return fail('FORBIDDEN', 'Session changes use the shared access store.');
      if (!validId(command?.commandId) || (!builder && !build?.writes)
        || (command.intentKey !== undefined && typeof command.intentKey !== 'string')) return invalid();
      const loaded = load();
      if (!loaded.ok) return loaded;
      const board = snapshot;
      const actor = board.users[board.session?.userId] ?? null;
      if (!command.sessionOnly && !actor) return fail('FORBIDDEN', 'Sign in to change the board.');
      if ((command.expectedGeneration !== undefined && command.expectedGeneration !== board.audit.generation)
        || (command.expectedSessionToken !== undefined && command.expectedSessionToken !== (board.session?.token ?? null))
        || (command.expectedSessionEpoch !== undefined && command.expectedSessionEpoch !== sessionEpoch)) return fail('STALE_INTENT', CHANGED);
      if (command.authorize !== undefined) {
        let authorization;
        try { authorization = command.authorize(board, actor); } catch { return invalid(); }
        if (authorization !== true) return authorization?.ok === false ? authorization : fail('FORBIDDEN', 'This action is not permitted.');
      }
      const {commandId, intentKey} = command;
      const saved = !command.sessionOnly && Object.hasOwn(board.audit.receipts, commandId) ? board.audit.receipts[commandId] : null;
      if (saved) return saved.actorId === actor.id && intentKey !== undefined && saved.intentKey === intentKey
        ? saved.safeResult : fail('ID_CONFLICT', CHANGED);
      const site = command.siteId === undefined ? null : board.sites[command.siteId];
      if (command.siteId !== undefined && !Object.hasOwn(board.sites, command.siteId)) return fail('NOT_FOUND', 'Site not found.');
      if ((command.expectedSiteRev !== undefined && site?.rev !== command.expectedSiteRev)
        || (command.assignmentRev !== undefined && board.program.crew.find(item => item.id === command.assignmentId && item.siteId === command.siteId)?.rev !== command.assignmentRev)) {
        return fail('STALE_INTENT', CHANGED);
      }
      let next;
      let prepared;
      let result;
      try {
        next = builder ? builder(board, actor) : build;
        if (next?.ok === false) return next;
        const {writes, result: resultValue = null} = next?.ok === true ? next.data : next;
        if (!writes || typeof writes !== 'object' || Array.isArray(writes)) return invalid();
        const allowed = command.sessionOnly ? ['session'] : BOARD_KEYS;
        if (!Object.keys(writes).every(key => allowed.includes(key))) return invalid();
        result = resultValue?.ok === false && resultValue.error ? resultValue : ok(resultValue);
        result = JSON.parse(stringify(result));
        prepared = Object.fromEntries(Object.entries(writes).map(([key, value]) => [key, encode(key, value)]));
        next = {...board};
        for (const [key, raw] of Object.entries(prepared)) next[key] = raw === null ? null : decode(raw);
        if (!command.sessionOnly && intentKey !== undefined && Object.keys(prepared).length) {
          next.audit = {...next.audit, receipts: {...next.audit.receipts, [commandId]: {actorId: actor.id, intentKey, safeResult: result}}};
          prepared.audit = encode('audit', next.audit);
        }
        validate(next);
        if (!historyUnchanged(board.audit, next.audit)) return invalid();
      } catch {
        return invalid();
      }
      const committed = persist(commandId, prepared, read(Object.keys(prepared)));
      if (!committed.ok) return committed;
      publish(next);
      return result;
    });
  }

  /** Read the safest available generation independently of damaged board records. */
  function restoreFence(rawAudit, rawJournal, local = true) {
    const candidates = local && generation !== null ? [generation] : [];
    try {
      const value = decode(rawAudit)?.generation;
      if (counter(value)) candidates.push(value);
    } catch { /* A damaged board may still be explicitly restored. */ }
    try {
      const journal = parseJournal(rawJournal, local ? journalKeys : BOARD_KEYS);
      if (journal.mode === 'restore') candidates.push(journal.targetGeneration);
      const prior = decode(journal.prior.audit)?.generation;
      if (counter(prior)) candidates.push(prior);
    } catch { /* A damaged journal may be replaced only after authorization. */ }
    return candidates.length ? Math.max(...candidates) : 0;
  }

  /** Restore only board keys, preserving access and unrelated storage verbatim.
   *
   * Args:
   *   command: {commandId, confirmed:true, expectedGeneration, expectedSessionToken?, expectedSessionEpoch?, allPrograms?}.
   *     Use the committed generation, or getRestoreGeneration() during recovery.
   * Returns:
   *   Generation and restored register, evidence, upload and notice counts only
   *   after successful journal removal. An interrupted restore rolls forward.
   */
  function restore(command) {
    return guarded(() => {
      if (!validId(command?.commandId) || command.confirmed !== true || !counter(command.expectedGeneration)) return invalid();
      const access = read(['users', 'session']);
      let session;
      try {
        session = access.session === null ? null : decode(access.session);
        validateAccess(decode(access.users), session);
      } catch { return recoveryError(); }
      if (session?.userId !== PERSON.samira || session.role !== 'Facilitator') return fail('FORBIDDEN', 'Only the cluster administrator can restore the morning board.');
      const prior = read(BOARD_KEYS);
      const currentGeneration = restoreFence(prior.audit, storage.getItem(storageKey(PENDING)));
      if (command.expectedGeneration !== currentGeneration || !counter(currentGeneration + 1)
        || (command.expectedSessionToken !== undefined && command.expectedSessionToken !== session.token)
        || (command.expectedSessionEpoch !== undefined && command.expectedSessionEpoch !== sessionEpoch)) return fail('STALE_INTENT', CHANGED);
      const targetGeneration = currentGeneration + 1;
      const targets = {};
      if (command.allPrograms === true && !scoped) {
        for (const id of Object.keys(PROGRAMS).filter(key => key !== DEFAULT_PROGRAM)) {
          const rawAudit = storage.getItem(boardKeyOf(id, 'audit'));
          const rawJournal = storage.getItem(boardKeyOf(id, PENDING));
          if (rawAudit === null && rawJournal === null && BOARD_KEYS.every(key => storage.getItem(boardKeyOf(id, key)) === null)) continue;
          const target = restoreFence(rawAudit, rawJournal, false) + 1;
          if (!counter(target)) return fail('STALE_INTENT', CHANGED);
          targets[id] = target;
        }
      }
      const marker = JSON.stringify({schemaVersion: SCHEMA_VERSION, commandId: command.commandId,
        mode: 'restore', keys: BOARD_KEYS, prior, targetGeneration, ...(Object.keys(targets).length ? {targets} : {})});
      try { write(PENDING, marker); } catch {
        if (storage.getItem(storageKey(PENDING)) === marker) { publish(null); return recoveryError(); }
        return writeError();
      }
      const board = finishRestore(targetGeneration, targets);
      publish(board);
      return ok({generation: targetGeneration, siteCount: Object.keys(board.sites).length,
        rowCount: Object.values(board.sites).reduce((count, site) => count + Object.keys(site.rows).length, 0),
        uploadCount: Object.keys(board.uploads).length, noticeCount: board.program.notices.length,
        unreadCount: board.program.notices.filter(notice => notice.unread).length});
    });
  }

  /** Return the current restore fence without reading or publishing a broken board. */
  function getRestoreGeneration() {
    try { return restoreFence(storage.getItem(storageKey('audit')), storage.getItem(storageKey(PENDING))); }
    catch { return null; }
  }

  /** Capture the validated administrator's confirmation fence independently of a locked board. */
  function getRestoreIntent() {
    try {
      const access = read(['users', 'session']);
      const session = access.session === null ? null : decode(access.session);
      validateAccess(decode(access.users), session);
      if (session?.userId !== PERSON.samira || session.role !== 'Facilitator') return null;
      const expectedGeneration = getRestoreGeneration();
      return expectedGeneration === null ? null : {expectedGeneration, expectedSessionToken: session.token,
        expectedSessionEpoch: sessionEpoch};
    } catch { return null; }
  }

  /** Save administrator settings without modifying scores, evidence or snapshots. */
  function saveThresholds(thresholds, commandId) {
    if (!validThresholds(thresholds)) return fail('BAD_INPUT', 'Use whole numbers and keep the Needs Attention minimum at or below both Good thresholds.');
    return commit({commandId, expectedGeneration: snapshot?.audit.generation,
      expectedSessionToken: snapshot?.session?.token, expectedSessionEpoch: sessionEpoch,
      authorize: (_board, actor) => actor?.id === PERSON.samira}, board => {
      const current = board.program.thresholds ?? DEFAULT_THRESHOLDS;
      return {writes: JSON.stringify(current) === JSON.stringify(thresholds) ? {} : {program: {...board.program, thresholds}}};
    });
  }

  return {bootstrap, recover, getSnapshot, subscribe, commit, restore, saveThresholds, getSessionEpoch, getRestoreGeneration, getRestoreIntent};
}

/** Defer browser storage access until the store can handle permission errors. */
export function createBrowserStore(programId = DEFAULT_PROGRAM) {
  return createStore({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key),
  }, programId);
}
