/** Exercise fixture parity and transaction boundaries with a controllable Storage adapter. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARD_KEYS, makeBaseline} from '../src/data/baseline.js';
import {DIRECTORY, PERSON} from '../src/data/people.js';
import {MORNING_SCORE_AT, ROW_ORDER} from '../src/data/register.js';
import {createStore, STORAGE_PREFIX} from '../src/utils/storage.js';

/** Encode a raw versioned storage value to simulate reload and recovery. */
const envelope = value => JSON.stringify({schemaVersion: 1, value});
/** Expand a fixture storage key. */
const key = name => `${STORAGE_PREFIX}${name}`;

/** Provide browser-like synchronous storage with injectable operation failures. */
class TestStorage {
  data = new Map();
  fault = () => {};

  /** Return null for absence, as browser Storage does. */
  getItem(k) { this.fault('get', k); return this.data.get(k) ?? null; }
  /** Write an exact string, with failure injection before or after mutation. */
  setItem(k, value) { this.fault('set', k, 'before'); this.data.set(k, String(value)); this.fault('set', k, 'after'); }
  /** Remove a key without affecting any other value. */
  removeItem(k) { this.fault('remove', k, 'before'); this.data.delete(k); this.fault('remove', k, 'after'); }
}

/** Boot a new isolated origin and optionally install a workshop session. */
function opened(userId = PERSON.samira) {
  const storage = new TestStorage();
  const store = createStore(storage);
  assert.equal(store.getSnapshot(), null);
  assert.equal(store.bootstrap().ok, true);
  if (userId) {
    const session = {userId, role: store.getSnapshot().users[userId].role, token: 'opaque-test-token', signedInAt: '2026-05-12T09:40:00'};
    assert.equal(store.commit({commandId: 'sign-in', sessionOnly: true}, {writes: {session}}).ok, true);
  }
  return {storage, store};
}

test('the released register and separate audit history match the morning fixtures', () => {
  const board = makeBaseline();
  const {sites, program, audit} = board;
  assert.equal(Object.keys(board.users).length, 6);
  assert.equal(Object.keys(DIRECTORY).length, 8);
  for (const user of Object.values(board.users)) assert.match(user.credentialVerifier, /^[0-9a-f]{64}$/);
  const all = Object.values(sites);
  assert.equal(all.length, 16);
  for (const site of all) assert.deepEqual(Object.keys(site.rows), ROW_ORDER);
  assert.equal(all.reduce((sum, site) => sum + site.notes.length, 0), 11);
  assert.deepEqual(['Green', 'Amber', 'Red'].map(risk => all.filter(site => site.risk === risk).length), [8, 5, 3]);
  assert.deepEqual(['Hold', 'Dispatched', 'On air'].map(disposition => all.filter(site => site.disposition === disposition).length), [2, 2, 2]);
  assert.deepEqual(Object.keys(board.uploads), ['doc_1842_power', 'doc_1851_permit', 'doc_1891_fail', 'doc_1847_brief', 'doc_1822_photo']);
  assert.deepEqual([program.crew.length, program.failures.length, program.design.length, program.notices.length, program.morning.length], [10, 3, 6, 12, 37]);
  assert.equal(program.notices.filter(notice => notice.unread).length, 8);
  assert.equal(program.failures.filter(failure => failure.state === 'Open').length, 1);
  assert.equal(Object.keys(program.sources).length, 7);
  assert.deepEqual(program.trend.map(point => point.greenShare), [71, 71, 69, 69, 67, 73, 73, 75, 75, 63, 63, 56, 56, 50]);
  const scores = audit.events.filter(event => event.verb === 'Scored');
  const morningScores = scores.filter(event => event.at === MORNING_SCORE_AT);
  assert.equal(scores.length, 17);
  assert.equal(audit.events.length, 50);
  assert.equal(morningScores.length, 14);
  assert.equal(new Set(morningScores.map(event => event.siteId)).size, 14);
  assert.equal(program.morning.filter(event => event.verb === 'Scored' && event.at === MORNING_SCORE_AT).length, 1);
  for (const event of morningScores) {
    const suffix = event.siteId.slice(-4);
    assert.equal(event.correlationId, `corr_${suffix}_a`);
    assert.equal(event.snapshotId, `snap_${suffix}_0934`);
    assert.equal(event.output, sites[event.siteId].assessment.probability);
    assert.equal(event.confidence, sites[event.siteId].assessment.confidence);
  }
  assert.equal(morningScores.find(event => event.siteId === 'NRO-W-1872').output, null);
  assert.deepEqual(scores.filter(event => ['NRO-W-1810', 'NRO-W-1816'].includes(event.siteId)).map(event => [event.output, event.confidence]), [[96, 94], [95, 93]]);
  assert.equal(sites['NRO-W-1810'].assessment.probability, null);
  assert.equal(sites['NRO-W-1816'].assessment.probability, null);
  const [legacy, morning] = scores.filter(event => event.siteId === 'NRO-W-1847');
  assert.equal(legacy.correlationId, morning.correlationId);
  assert.notEqual(legacy.snapshotId, morning.snapshotId);
  const approval = sites['NRO-W-1847'].decisions[0];
  assert.equal(approval.assessmentRef, legacy.snapshotId);
  assert.equal(approval.scope.assignmentId, 'crew_1847');
  assert.equal(approval.scope.kind, 'dispatch');
  const market = sites['NRO-W-1855'];
  assert.deepEqual(market.rows.Material.observations.map(observation => observation.status), ['Ready', 'Not Ready']);
  market.rows.Material.observations[0].status = 'Not Ready';
  assert.equal(audit.snapshots.snap_1855_0934.rows[4].observations[0].status, 'Ready');
  assert.equal(makeBaseline().sites['NRO-W-1855'].rows.Material.observations[0].status, 'Ready');
});

test('bootstrap fills only absent pristine keys and rejects incompatible or incomplete adopted state', () => {
  const {store, storage} = opened(null);
  const first = store.getSnapshot();
  assert.ok(Object.isFrozen(first.sites['NRO-W-1842'].rows.Power));
  assert.equal(storage.getItem(key('session')), null);
  const raw = storage.getItem(key('sites'));
  storage.setItem(key('sites'), ` ${raw}`);
  storage.removeItem(key('faults'));
  assert.equal(store.bootstrap().ok, true);
  assert.strictEqual(store.getSnapshot(), first);
  assert.equal(storage.getItem(key('sites')), ` ${raw}`);
  storage.setItem(key('scenario'), envelope('D'));
  storage.removeItem(key('faults'));
  assert.equal(store.bootstrap().error.code, 'RECOVERY_REQUIRED');
  assert.equal(store.getSnapshot(), null);
  assert.equal(storage.getItem(key('faults')), null);
  storage.setItem(key('scenario'), '{"schemaVersion":2,"value":"A"}');
  assert.equal(store.bootstrap().error.code, 'RECOVERY_REQUIRED');
  assert.equal(storage.getItem(key('scenario')), '{"schemaVersion":2,"value":"A"}');
});

test('commit publishes once, replays matching receipts and refuses stale, conflicted or invalid writes', () => {
  const {store, storage} = opened();
  const delivered = [];
  const unsubscribe = store.subscribe(() => {
    assert.equal(storage.getItem(key('pendingCommit')), null);
    delivered.push(store.getSnapshot().scenario);
  });
  const command = {commandId: 'scenario', expectedGeneration: 0, intentKey: 'scenario:D'};
  const result = store.commit(command, {build: () => ({ok: true, data: {writes: {scenario: 'D'}, result: {active: 'D'}}})});
  assert.deepEqual(result, {ok: true, data: {active: 'D'}});
  assert.deepEqual(delivered, ['D']);
  assert.deepEqual(store.commit(command, () => assert.fail('receipt must replay')), result);
  assert.equal(store.commit({...command, authorize: () => false}, {writes: {scenario: 'D'}}).error.code, 'FORBIDDEN');
  assert.equal(store.commit({...command, intentKey: 'scenario:A'}, {writes: {scenario: 'A'}}).error.code, 'ID_CONFLICT');
  assert.equal(store.commit({...command, expectedGeneration: 1}, {writes: {scenario: 'A'}}).error.code, 'STALE_INTENT');
  const invalidAudit = structuredClone(store.getSnapshot().audit);
  invalidAudit.events[0].detail = 'Changed history';
  assert.equal(store.commit({commandId: 'invalid'}, {writes: {audit: invalidAudit}}).error.code, 'BAD_INPUT');
  assert.equal(store.commit({commandId: 'invalid'}, {writes: {uploads: {bad: {id: 'bad', siteId: 'unreleased'}}}}).error.code, 'BAD_INPUT');
  assert.equal(store.commit({commandId: 'invalid'}, {writes: {program: {...store.getSnapshot().program, extra: NaN}}}).error.code, 'BAD_INPUT');
  unsubscribe();
  assert.equal(store.commit({commandId: 'back'}, {writes: {scenario: 'A'}}).ok, true);
  assert.deepEqual(delivered, ['D']);
});

test('write and commit-point failure roll back exact bytes and never notify a partial board', () => {
  for (const [operation, name, phase] of [['set', 'faults', 'before'], ['remove', 'pendingCommit', 'after']]) {
    const {storage, store} = opened();
    storage.setItem(key('scenario'), ` ${storage.getItem(key('scenario'))}`);
    const before = new Map(storage.data);
    const snapshot = store.getSnapshot();
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    storage.fault = (op, k, stage) => {
      if (op === operation && k === key(name) && stage === phase) {
        storage.fault = () => {};
        throw new Error('Interrupted commit');
      }
    };
    assert.equal(store.commit({commandId: 'interrupt'}, {writes: {scenario: 'D', faults: {...snapshot.faults, assessmentDown: true}}}).error.code, 'STORAGE_WRITE');
    assert.deepEqual(storage.data, before);
    assert.strictEqual(store.getSnapshot(), snapshot);
    assert.equal(notified, 0);
  }
});

test('abandoned initialization rolls back prior absence on the next load', () => {
  const storage = new TestStorage();
  storage.setItem(key('scenario'), envelope('D'));
  storage.setItem(key('pendingCommit'), JSON.stringify({schemaVersion: 1, commandId: 'interrupted', mode: 'rollback',
    keys: ['scenario'], prior: {scenario: null}, targetGeneration: null}));
  const store = createStore(storage);
  assert.equal(store.recover().ok, true);
  assert.equal(store.getSnapshot().scenario, 'A');
  assert.equal(storage.getItem(key('pendingCommit')), null);
});

test('failed rollback suppresses the board; Samira restores only board keys and retains sign-in', () => {
  const {storage, store} = opened();
  storage.setItem('unrelated.preference', 'keep me');
  const oldSession = storage.getItem(key('session'));
  const oldUsers = storage.getItem(key('users'));
  const faults = {...store.getSnapshot().faults, assessmentDown: true};
  let failCount = 2;
  storage.fault = (op, k, phase) => {
    if (op === 'set' && k === key('faults') && phase === 'before' && failCount-- > 0) throw new Error('Write and rollback denied');
  };
  assert.equal(store.commit({commandId: 'interrupt'}, {writes: {scenario: 'D', faults}}).error.code, 'RECOVERY_REQUIRED');
  assert.equal(store.getSnapshot(), null);
  assert.ok(storage.getItem(key('pendingCommit')));
  storage.fault = () => {};
  const restore = {commandId: 'restore', confirmed: true, expectedGeneration: 0, expectedSessionToken: 'opaque-test-token'};
  assert.equal(store.restore({...restore, confirmed: false}).error.code, 'BAD_INPUT');
  assert.equal(store.restore({...restore, expectedSessionToken: 'old'}).error.code, 'STALE_INTENT');
  assert.deepEqual(store.restore(restore), {ok: true, data: {generation: 1, siteCount: 16, rowCount: 96, uploadCount: 5, noticeCount: 12, unreadCount: 8}});
  const seed = makeBaseline();
  seed.audit.generation = 1;
  for (const name of BOARD_KEYS) assert.deepEqual(store.getSnapshot()[name], seed[name]);
  assert.equal(storage.getItem(key('session')), oldSession);
  assert.equal(storage.getItem(key('users')), oldUsers);
  assert.equal(storage.getItem('unrelated.preference'), 'keep me');
  assert.equal(storage.getItem(key('pendingCommit')), null);
});

test('restore rejects other actors and rolls forward across reload once authorized', () => {
  const wrong = opened(PERSON.jordan);
  const command = {commandId: 'restore', confirmed: true, expectedGeneration: 0};
  assert.equal(wrong.store.restore(command).error.code, 'FORBIDDEN');
  assert.equal(wrong.storage.getItem(key('pendingCommit')), null);
  const {storage, store} = opened();
  assert.equal(store.commit({commandId: 'change'}, {writes: {scenario: 'D'}}).ok, true);
  storage.fault = (op, k, phase) => {
    if (op === 'set' && k === key('sites') && phase === 'before') throw new Error('Interrupted restore');
  };
  assert.equal(store.restore(command).error.code, 'RECOVERY_REQUIRED');
  assert.equal(store.getSnapshot(), null);
  assert.equal(store.getRestoreGeneration(), 1);
  assert.equal(JSON.parse(storage.getItem(key('pendingCommit'))).mode, 'restore');
  storage.fault = () => {};
  const reloaded = createStore(storage);
  assert.equal(reloaded.bootstrap().ok, true);
  assert.equal(reloaded.getSnapshot().session.userId, PERSON.samira);
  assert.equal(reloaded.getSnapshot().audit.generation, 1);
  assert.equal(reloaded.getSnapshot().scenario, 'A');
  assert.equal(reloaded.restore(command).error.code, 'STALE_INTENT');
});

test('marker allocation failure leaves the existing board and storage untouched', () => {
  const {storage, store} = opened();
  const snapshot = store.getSnapshot();
  const before = new Map(storage.data);
  storage.fault = (operation, name, phase) => {
    if (operation === 'set' && name === key('pendingCommit') && phase === 'before') throw new Error('Journal quota');
  };
  assert.equal(store.commit({commandId: 'change'}, {writes: {scenario: 'D'}}).error.code, 'STORAGE_WRITE');
  assert.equal(store.restore({commandId: 'restore', confirmed: true, expectedGeneration: 0}).error.code, 'STORAGE_WRITE');
  assert.strictEqual(store.getSnapshot(), snapshot);
  assert.deepEqual(storage.data, before);
});

/** Interrupt one numbered set operation, or the journal removal, at the requested boundary. */
function interruptAt(storage, store, operation, nth, phase) {
  const visited = [];
  const interrupted = [];
  let count = 0;
  storage.fault = (op, rawKey, stage) => {
    if (stage === 'after') visited.push(store.getSnapshot());
    if (op === operation && stage === phase && ++count === nth) {
      interrupted.push(rawKey);
      throw new Error('Injected storage interruption');
    }
  };
  return {visited, interrupted};
}

const pending = key('pendingCommit');
const commitWrites = ['pendingCommit', 'scenario', 'faults', 'audit'];
const restoreWrites = ['pendingCommit', ...BOARD_KEYS];

for (const phase of ['before', 'after']) {
  for (const [operation, nth, name] of [...commitWrites.map((name, i) => ['set', i + 1, name]), ['remove', 1, 'pendingCommit']]) {
    test(`commit ${phase} ${operation} #${nth} (${name}) rolls back exact bytes and never publishes`, () => {
      const {storage, store} = opened();
      storage.setItem('unrelated.preference', 'leave alone');
      for (const name of ['scenario', 'faults', 'audit']) storage.setItem(key(name), ` \n${storage.getItem(key(name))}\t`);
      const before = new Map(storage.data);
      const snapshot = store.getSnapshot();
      const published = [];
      store.subscribe(() => published.push(store.getSnapshot()));
      const {visited, interrupted} = interruptAt(storage, store, operation, nth, phase);

      const result = store.commit({commandId: 'interrupted', intentKey: 'change-scenario-and-faults'},
        {writes: {scenario: 'D', faults: {...snapshot.faults, assessmentDown: true}}, result: 'changed'});

      assert.equal(result.error.code, 'STORAGE_WRITE');
      assert.deepEqual(interrupted, [key(name)]);
      for (const observed of visited) assert.strictEqual(observed, snapshot);
      assert.deepEqual(published, []);
      assert.strictEqual(store.getSnapshot(), snapshot);
      assert.deepEqual(storage.data, before);
      const reloaded = createStore(storage);
      assert.equal(reloaded.bootstrap().ok, true);
      assert.deepEqual(reloaded.getSnapshot(), snapshot);
      assert.deepEqual(storage.data, before);
    });
  }

  for (const [operation, nth, name] of [...restoreWrites.map((name, i) => ['set', i + 1, name]), ['remove', 1, 'pendingCommit']]) {
    test(`restore ${phase} ${operation} #${nth} (${name}) publishes no mixed board and reloads the right generation`, () => {
      const {storage, store} = opened();
      assert.equal(store.commit({commandId: 'dirty', intentKey: 'dirty'},
        {writes: {scenario: 'D', faults: {...store.getSnapshot().faults, assessmentDown: true}}}).ok, true);
      // Whitespace distinguishes rewritten baseline records from identical decoded values.
      for (const name of [...BOARD_KEYS, 'users', 'session']) storage.setItem(key(name), ` \n${storage.getItem(key(name))}\t`);
      storage.setItem('unrelated.preference', 'leave alone');
      const before = new Map(storage.data);
      const snapshot = store.getSnapshot();
      const published = [];
      store.subscribe(() => published.push(store.getSnapshot()));
      const {visited, interrupted} = interruptAt(storage, store, operation, nth, phase);
      const command = {commandId: 'interrupted-restore', confirmed: true, expectedGeneration: 0};

      const result = store.restore(command);

      const notStarted = operation === 'set' && nth === 1 && phase === 'before';
      assert.equal(result.error.code, notStarted ? 'STORAGE_WRITE' : 'RECOVERY_REQUIRED');
      assert.deepEqual(interrupted, [key(name)]);
      for (const observed of visited) assert.strictEqual(observed, snapshot);
      assert.deepEqual(published, notStarted ? [] : [null]);
      assert.strictEqual(store.getSnapshot(), notStarted ? snapshot : null);

      const baseline = makeBaseline();
      baseline.audit.generation = 1;
      const interim = new Map(before);
      if (!notStarted) {
        const written = operation === 'remove' ? BOARD_KEYS.length : nth - (phase === 'after' ? 1 : 2);
        for (const name of BOARD_KEYS.slice(0, Math.max(0, written))) interim.set(key(name), envelope(baseline[name]));
        if (operation !== 'remove' || phase !== 'after') {
          const prior = Object.fromEntries(BOARD_KEYS.map(name => [name, before.get(key(name))]));
          const journal = {schemaVersion: 1, commandId: command.commandId, mode: 'restore', keys: BOARD_KEYS, prior, targetGeneration: 1};
          assert.deepEqual(JSON.parse(storage.getItem(pending)), journal);
          interim.set(pending, storage.getItem(pending));
        }
      }
      assert.deepEqual(storage.data, interim);

      const expectedRaw = new Map(before);
      if (!notStarted) for (const name of BOARD_KEYS) expectedRaw.set(key(name), envelope(baseline[name]));
      const expectedBoard = notStarted ? snapshot : {...baseline, users: snapshot.users, session: snapshot.session};
      storage.fault = () => {};
      const reloaded = createStore(storage);
      assert.equal(reloaded.getSnapshot(), null);
      const reloadPublications = [];
      reloaded.subscribe(() => reloadPublications.push({board: reloaded.getSnapshot(), raw: new Map(storage.data)}));
      assert.equal(reloaded.bootstrap().ok, true);
      assert.equal(reloaded.recover().ok, true);
      assert.deepEqual(reloadPublications, [{board: expectedBoard, raw: expectedRaw}]);
      assert.deepEqual(storage.data, expectedRaw);
    });
  }
}

test('an incomplete rollback stays locked across reload until every prior byte can be restored', () => {
  const {storage, store} = opened();
  storage.setItem(key('scenario'), ` \n${storage.getItem(key('scenario'))}`);
  const before = new Map(storage.data);
  const snapshot = store.getSnapshot();
  const notifications = [];
  store.subscribe(() => notifications.push(store.getSnapshot()));
  let scenarioWritten = false;
  storage.fault = (op, rawKey, phase) => {
    if (op !== 'set') return;
    if (rawKey === key('scenario') && phase === 'after') scenarioWritten = true;
    if (scenarioWritten && phase === 'before') throw new Error('Write and rollback interrupted');
  };
  assert.equal(store.commit({commandId: 'incomplete'},
    {writes: {scenario: 'D', faults: {...snapshot.faults, assessmentDown: true}}}).error.code, 'RECOVERY_REQUIRED');
  assert.deepEqual(notifications, [null]);
  assert.equal(store.getSnapshot(), null);
  const journal = storage.getItem(pending);
  assert.deepEqual(JSON.parse(journal), {schemaVersion: 1, commandId: 'incomplete', mode: 'rollback',
    keys: ['scenario', 'faults'], prior: {scenario: before.get(key('scenario')), faults: before.get(key('faults'))}, targetGeneration: null});

  const interrupted = new Map(before).set(key('scenario'), envelope('D')).set(pending, journal);
  assert.deepEqual(storage.data, interrupted);
  const reloaded = createStore(storage);
  const published = [];
  reloaded.subscribe(() => published.push({board: reloaded.getSnapshot(), raw: new Map(storage.data)}));
  assert.equal(reloaded.bootstrap().error.code, 'RECOVERY_REQUIRED');
  assert.equal(reloaded.getSnapshot(), null);
  assert.deepEqual(published, []);
  assert.deepEqual(storage.data, interrupted);
  storage.fault = () => {};
  assert.equal(reloaded.recover().ok, true);
  assert.deepEqual(published, [{board: snapshot, raw: before}]);
  assert.deepEqual(storage.data, before);
});

const validJournal = {schemaVersion: 1, commandId: 'corrupt', mode: 'rollback', keys: ['scenario'],
  prior: {scenario: envelope('D')}, targetGeneration: null};
for (const [label, raw] of [
  ['malformed JSON', '{broken'],
  ['unknown schema version', JSON.stringify({...validJournal, schemaVersion: 2})],
  ['unknown mode', JSON.stringify({...validJournal, mode: 'unknown'})],
  ['unknown key', JSON.stringify({...validJournal, keys: ['unrecognized'], prior: {unrecognized: null}})],
  ['duplicate keys', JSON.stringify({...validJournal, keys: ['scenario', 'scenario']})],
  ['missing prior entry', JSON.stringify({...validJournal, prior: {faults: null}})],
  ['non-raw prior value', JSON.stringify({...validJournal, prior: {scenario: {value: 'D'}}})],
  ['incomplete restore footprint', JSON.stringify({...validJournal, mode: 'restore', targetGeneration: 1})],
  ['invalid restore generation', JSON.stringify({...validJournal, mode: 'restore', targetGeneration: 0, keys: BOARD_KEYS,
    prior: Object.fromEntries(BOARD_KEYS.map(name => [name, null]))})],
]) {
  test(`corrupt journal (${label}) locks the board without applying or deleting any raw records`, () => {
    const {storage, store} = opened();
    storage.setItem(pending, raw);
    storage.setItem('unrelated.preference', 'leave alone');
    const before = new Map(storage.data);
    const mutations = [];
    storage.fault = (op, rawKey, phase) => { if (phase === 'before') mutations.push([op, rawKey]); };
    const published = [];
    store.subscribe(() => published.push(store.getSnapshot()));
    assert.equal(store.recover().error.code, 'RECOVERY_REQUIRED');
    assert.equal(store.getSnapshot(), null);
    assert.deepEqual(published, [null]);

    const reloaded = createStore(storage);
    reloaded.subscribe(() => published.push(reloaded.getSnapshot()));
    assert.equal(reloaded.bootstrap().error.code, 'RECOVERY_REQUIRED');
    assert.equal(reloaded.getSnapshot(), null);
    assert.deepEqual(published, [null]);
    assert.deepEqual(mutations, []);
    assert.deepEqual(storage.data, before);
  });
}
