/** Exercise workshop controls against the actual journaled browser-store contract. */
import {webcrypto} from 'node:crypto';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {BOARD_KEYS, makeBaseline} from '../src/data/baseline.js';
import {PERSON} from '../src/data/people.js';
import {runAssessment, keepLastScore} from '../src/services/assessment.js';
import {attachEvidence} from '../src/services/evidence.js';
import {readSources, restoreMorning, selectScenario, selectShellHealth, setFault} from '../src/services/sources.js';
import {continueAs, switchUser} from '../src/utils/access.js';
import {createStore, STORAGE_PREFIX} from '../src/utils/storage.js';

const HARBOR = 'NRO-W-1842';

/** Seed the real store over an isolated, controllable Storage adapter. */
function session(person = PERSON.samira) {
  const entries = new Map();
  const storage = {getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key)};
  const store = createStore(storage);
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, person).ok).toBe(true);
  return {store, storage, entries};
}

/** Read the effective health of a given adapter from the current committed board. */
function health(store, source) {
  const {program, faults} = store.getSnapshot();
  return readSources(program, faults).find(row => row.sourceId === source);
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('projects seven local sources, retains Delayed and last sync, and shares the same DDL row with the shell', () => {
  const {store} = session();
  const before = store.getSnapshot();
  const result = setFault(store, {commandId: 'ddl', source: 'DDL', state: 'Down'});
  expect(result).toEqual({ok: true, data: {source: 'DDL', state: 'Down', lastSyncAt: '2026-05-12T09:22:00'}});
  const board = store.getSnapshot();
  const rows = readSources(board.program, board.faults);
  expect(rows.map(row => row.sourceId)).toEqual(['DPAM', 'POS', 'DDL', 'ECO', 'City portal', 'Northwind Power feed', 'Assessment']);
  expect(health(store, 'City portal').state).toBe('Delayed');
  expect(selectShellHealth(rows)).toEqual({items: rows.slice(0, 4), age: 6});
  expect(board.sites['NRO-W-1855'].rows.Material).toEqual(before.sites['NRO-W-1855'].rows.Material);
  expect(board.program).toEqual(before.program);
});

it('rejects unauthorized, stale or invalid controls without changing raw records', () => {
  const {store, entries} = session(PERSON.priya);
  const before = new Map(entries);
  expect(setFault(store, {commandId: 'denied', source: 'DDL', state: 'Down'}).error.code).toBe('FORBIDDEN');
  expect(selectScenario(store, {commandId: 'denied', scenario: 'D'}).error.code).toBe('FORBIDDEN');
  expect(store.getRestoreIntent()).toBeNull();
  expect(restoreMorning(store, {commandId: 'denied', confirmed: true, expectedGeneration: 0}).error.code).toBe('FORBIDDEN');
  expect(entries).toEqual(before);
  expect(switchUser(store, PERSON.samira).ok).toBe(true);
  const authorized = new Map(entries);
  expect(setFault(store, {commandId: 'bad-source', source: 'POS', state: 'Down'}).error.code).toBe('BAD_INPUT');
  expect(setFault(store, {commandId: 'bad-state', source: 'DDL', state: 'Delayed'}).error.code).toBe('BAD_INPUT');
  expect(selectScenario(store, {commandId: 'bad-scenario', scenario: '__proto__'}).error.code).toBe('BAD_INPUT');
  expect(setFault(store, {commandId: 'stale', source: 'DDL', state: 'Down', expectedGeneration: 99}).error.code).toBe('STALE_INTENT');
  expect(entries).toEqual(authorized);
});

it('keeps separate manual and scenario faults and leaves Portside plan and session untouched', () => {
  const {store} = session();
  const {sites, session: originalSession} = store.getSnapshot();
  expect(setFault(store, {commandId: 'manual', source: 'Assessment', state: 'Down'}).ok).toBe(true);
  expect(setFault(store, {commandId: 'manual-ddl', source: 'DDL', state: 'Up'}).ok).toBe(true);
  expect(selectScenario(store, {commandId: 'interruption', scenario: 'D'}).data.label).toBe('Service interruption');
  expect(health(store, 'DDL').state).toBe('Down');
  expect(store.getSnapshot().faults.retryFailuresRemaining).toBe(1);
  expect(selectScenario(store, {commandId: 'exceptions', scenario: 'B'}).data.label).toBe('Exception');
  expect(store.getSnapshot().faults).toMatchObject({assessmentDown: true, ddlOverride: 'Up', scenarioAssessmentDown: false,
    scenarioDdlDown: false, forceLowConfidence: true, retryFailuresRemaining: 1});
  expect(health(store, 'Assessment').state).toBe('Down');
  expect(health(store, 'DDL').state).toBe('Up');
  expect(setFault(store, {commandId: 'recover-manual', source: 'Assessment', state: 'Up'}).ok).toBe(true);
  expect(store.getSnapshot().faults.retryFailuresRemaining).toBe(0);
  expect(selectScenario(store, {commandId: 'portside', scenario: 'C'}).data).toEqual({label: 'Consequential decision', navigateTo: '/sites/NRO-W-1866?tab=approval'});
  expect(selectScenario(store, {commandId: 'normal', scenario: 'A'}).data.label).toBe('Normal');
  expect(store.getSnapshot().sites).toEqual(sites);
  expect(store.getSnapshot().session).toEqual(originalSession);
});

it('keeps the prior score unmodified on failure and Retry recovers assessment only', async () => {
  const {store, entries} = session();
  selectScenario(store, {commandId: 'interruption', scenario: 'D'});
  const prior = store.getSnapshot().program.lastScore;
  const scored = store.getSnapshot().audit.events.filter(event => event.verb === 'Scored').length;
  const first = runAssessment(store, {commandId: 'retry-first', siteId: HARBOR, mode: 'retry'});
  await vi.advanceTimersByTimeAsync(700);
  expect((await first).data).toMatchObject({state: 'retained_outage', scoredAt: prior.scoredAt, correlationId: prior.correlationId});
  expect(store.getSnapshot().audit.events.filter(event => event.verb === 'Scored')).toHaveLength(scored);
  const unchanged = new Map(entries);
  expect(keepLastScore(store, {siteId: HARBOR}).data.scoredAt).toBe(prior.scoredAt);
  expect(entries).toEqual(unchanged);
  expect(health(store, 'Assessment').lastSyncAt).toBe(prior.scoredAt);
  const second = runAssessment(store, {commandId: 'retry-second', siteId: HARBOR, mode: 'retry'});
  await vi.advanceTimersByTimeAsync(700);
  expect((await second).data).toMatchObject({state: 'current', probability: 34, correlationId: 'corr_1842_r1'});
  expect(health(store, 'DDL').state).toBe('Down');
  expect(health(store, 'Assessment')).toMatchObject({state: 'Up', lastSyncAt: '2026-05-12T09:40:00'});
});

it('restores exact board fixtures from lockout while preserving users, session and unrelated storage', () => {
  const {store, storage, entries} = session(PERSON.elena);
  expect(attachEvidence(store, {commandId: 'attach', siteId: HARBOR, expectedSiteRev: 0, row: 'Power',
    fileName: 'site-scan.png', mediaType: 'image/png', sizeBytes: 20}).ok).toBe(true);
  expect(switchUser(store, PERSON.samira).ok).toBe(true);
  expect(selectScenario(store, {commandId: 'interruption', scenario: 'D'}).ok).toBe(true);
  entries.set('other-app', 'leave alone');
  const sessionRaw = entries.get(`${STORAGE_PREFIX}session`);
  const usersRaw = entries.get(`${STORAGE_PREFIX}users`);
  entries.set(`${STORAGE_PREFIX}sites`, '{broken');
  const locked = createStore(storage);
  expect(locked.bootstrap().error.code).toBe('RECOVERY_REQUIRED');
  expect(locked.getSnapshot()).toBeNull();
  const intent = locked.getRestoreIntent();
  expect(intent).not.toBeNull();
  const before = new Map(entries);
  expect(restoreMorning(locked, {...intent, commandId: 'unconfirmed', confirmed: false}).error.code).toBe('BAD_INPUT');
  expect(entries).toEqual(before);
  const restored = restoreMorning(locked, {...intent, commandId: 'restore', confirmed: true});
  expect(restored.data).toEqual({generation: 1, siteCount: 16, rowCount: 96, uploadCount: 5, noticeCount: 12, unreadCount: 8});
  const baseline = makeBaseline();
  baseline.audit.generation = 1;
  for (const key of BOARD_KEYS) expect(locked.getSnapshot()[key]).toEqual(baseline[key]);
  expect(entries.get(`${STORAGE_PREFIX}session`)).toBe(sessionRaw);
  expect(entries.get(`${STORAGE_PREFIX}users`)).toBe(usersRaw);
  expect(entries.get('other-app')).toBe('leave alone');
  expect(restoreMorning(locked, {...intent, commandId: 'stale', confirmed: true}).error.code).toBe('STALE_INTENT');
});

it('rejects a restore confirmed after switching away and back to the facilitator', () => {
  const {store, entries} = session();
  const opened = store.getRestoreIntent();
  expect(switchUser(store, PERSON.priya).ok).toBe(true);
  expect(switchUser(store, PERSON.samira).ok).toBe(true);
  const before = new Map(entries);
  expect(restoreMorning(store, {...opened, commandId: 'stale-session', confirmed: true}).error.code).toBe('STALE_INTENT');
  expect(entries).toEqual(before);
});
