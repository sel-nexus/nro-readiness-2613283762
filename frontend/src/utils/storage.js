/** Persist and recover one workshop tab's board without exposing incomplete transactions. */
import {BOARD_KEYS, counter, makeBaseline, validateAccess, validateBoard} from '../data/baseline.js';
import {freezeTree, PERSON} from '../data/people.js';

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

/** Decode one versioned record; absence is handled by initialization, not here. */
function decode(raw) {
  const envelope = JSON.parse(raw);
  if (envelope?.schemaVersion !== SCHEMA_VERSION || !Object.hasOwn(envelope, 'value')) throw new Error('Unsupported storage record.');
  return envelope.value;
}

/** Validate a pending marker before acting on its key names or values. */
function parseJournal(raw) {
  const journal = JSON.parse(raw);
  if (journal?.schemaVersion !== SCHEMA_VERSION || !validId(journal.commandId)
    || !Array.isArray(journal.keys) || !journal.keys.length || new Set(journal.keys).size !== journal.keys.length
    || !journal.keys.every(key => KEYS.includes(key)) || !journal.prior || Array.isArray(journal.prior)
    || Object.keys(journal.prior).length !== journal.keys.length
    || !journal.keys.every(key => Object.hasOwn(journal.prior, key) && (journal.prior[key] === null || typeof journal.prior[key] === 'string'))
    || (journal.mode !== 'rollback' && (journal.mode !== 'restore' || !counter(journal.targetGeneration)
      || journal.targetGeneration < 1 || journal.keys.length !== BOARD_KEYS.length || !BOARD_KEYS.every(key => journal.keys.includes(key))))) {
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

/** Create a single-tab store using the Storage getItem/setItem/removeItem contract.
 *
 * Args:
 *   storage: The workshop origin's local storage or an injected synchronous adapter.
 * Returns:
 *   Bootstrap/recovery, stable snapshot subscription, transaction and reset methods.
 * Notes:
 *   Domain services authorize specific intents in their synchronous builder, using
 *   the live actor supplied by the store. Storage is not a production security boundary.
 */
export function createStore(storage) {
  let snapshot = null;
  let generation = null;
  let sessionEpoch = 0;
  let busy = false;
  const listeners = new Set();

  /** Apply a raw value exactly; null means the original key did not exist. */
  function write(key, raw) {
    if (raw === null) storage.removeItem(keyOf(key));
    else storage.setItem(keyOf(key), raw);
  }

  /** Read the specified keys without inventing values for unavailable records. */
  function read(keys) {
    return Object.fromEntries(keys.map(key => [key, storage.getItem(keyOf(key))]));
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
  function finishRestore(targetGeneration) {
    const seed = makeBaseline();
    const access = read(['users', 'session']);
    seed.users = decode(access.users);
    seed.session = access.session === null ? null : decode(access.session);
    seed.audit.generation = targetGeneration;
    validateBoard(seed);
    for (const key of BOARD_KEYS) write(key, encode(key, seed[key]));
    write(PENDING, null);
    return seed;
  }

  /** Resolve any journal before attempting to consume the current board. */
  function replayPending() {
    const raw = storage.getItem(keyOf(PENDING));
    if (raw === null) return;
    const journal = parseJournal(raw);
    if (journal.mode === 'restore') finishRestore(journal.targetGeneration);
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
        const currentMarker = storage.getItem(keyOf(PENDING));
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
    replayPending();
    const raw = read(KEYS);
    const board = makeBaseline();
    const absent = {};
    for (const key of KEYS) {
      if (raw[key] !== null) board[key] = decode(raw[key]);
      else if (key !== 'session') absent[key] = encode(key, board[key]);
    }
    if (BOARD_KEYS.some(key => Object.hasOwn(absent, key))) {
      const seed = makeBaseline();
      // A changed adopted board cannot silently regain a missing mutable record.
      if (BOARD_KEYS.some(key => raw[key] !== null && JSON.stringify(board[key]) !== JSON.stringify(seed[key]))) {
        publish(null);
        return recoveryError();
      }
    }
    validateBoard(board);
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
        validateBoard(next);
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
  function restoreFence(rawAudit, rawJournal) {
    const candidates = generation === null ? [] : [generation];
    try {
      const value = decode(rawAudit)?.generation;
      if (counter(value)) candidates.push(value);
    } catch { /* A damaged board may still be explicitly restored. */ }
    try {
      const journal = parseJournal(rawJournal);
      if (journal.mode === 'restore') candidates.push(journal.targetGeneration);
      const prior = decode(journal.prior.audit)?.generation;
      if (counter(prior)) candidates.push(prior);
    } catch { /* A damaged journal may be replaced only after authorization. */ }
    return candidates.length ? Math.max(...candidates) : 0;
  }

  /** Restore only board keys, preserving access and unrelated storage verbatim.
   *
   * Args:
   *   command: {commandId, confirmed:true, expectedGeneration, expectedSessionToken?, expectedSessionEpoch?}.
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
      const currentGeneration = restoreFence(prior.audit, storage.getItem(keyOf(PENDING)));
      if (command.expectedGeneration !== currentGeneration || !counter(currentGeneration + 1)
        || (command.expectedSessionToken !== undefined && command.expectedSessionToken !== session.token)
        || (command.expectedSessionEpoch !== undefined && command.expectedSessionEpoch !== sessionEpoch)) return fail('STALE_INTENT', CHANGED);
      const targetGeneration = currentGeneration + 1;
      const marker = JSON.stringify({schemaVersion: SCHEMA_VERSION, commandId: command.commandId,
        mode: 'restore', keys: BOARD_KEYS, prior, targetGeneration});
      try { write(PENDING, marker); } catch {
        if (storage.getItem(keyOf(PENDING)) === marker) { publish(null); return recoveryError(); }
        return writeError();
      }
      const board = finishRestore(targetGeneration);
      publish(board);
      return ok({generation: targetGeneration, siteCount: Object.keys(board.sites).length,
        rowCount: Object.values(board.sites).reduce((count, site) => count + Object.keys(site.rows).length, 0),
        uploadCount: Object.keys(board.uploads).length, noticeCount: board.program.notices.length,
        unreadCount: board.program.notices.filter(notice => notice.unread).length});
    });
  }

  /** Return the current restore fence without reading or publishing a broken board. */
  function getRestoreGeneration() {
    try { return restoreFence(storage.getItem(keyOf('audit')), storage.getItem(keyOf(PENDING))); }
    catch { return null; }
  }

  return {bootstrap, recover, getSnapshot, subscribe, commit, restore, getSessionEpoch, getRestoreGeneration};
}

/** Defer browser storage access until the store can handle permission errors. */
export function createBrowserStore() {
  return createStore({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key),
  });
}
