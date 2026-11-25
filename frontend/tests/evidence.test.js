/** Exercise the real storage transaction, readiness thresholds and deterministic replay. */
import {webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {makeBaseline} from '../src/data/baseline.js';
import {PERSON} from '../src/data/people.js';
import {BOARD_AT} from '../src/data/register.js';
import {keepLastScore, runAssessment} from '../src/services/assessment.js';
import {attachEvidence, saveEvidence, siteFence} from '../src/services/evidence.js';
import {continueAs, switchUser} from '../src/utils/access.js';
import {selectPortfolio} from '../src/utils/portfolio.js';
import {deriveReadiness, inHorizon, rowQuality} from '../src/utils/readiness.js';
import {createStore} from '../src/utils/storage.js';

const HARBOR = 'NRO-W-1842';
const EAST = 'NRO-W-1872';
const CIVIC = 'NRO-W-1847';
const MARKET = 'NRO-W-1855';

/** Start from the real seeded board using a synchronous, fault-injectable test adapter. */
function session(id = PERSON.elena) {
  const records = new Map();
  let failWrite = null;
  const store = createStore({getItem: key => records.get(key) ?? null, removeItem: key => records.delete(key),
    setItem: (key, value) => {
      if (key === failWrite) { failWrite = null; throw new Error('Quota'); }
      records.set(key, value);
    }});
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, id).ok).toBe(true);
  return {store, failOn: key => { failWrite = `nro.demo.${key}`; }};
}

/** Build the edit command from the actual committed site and session. */
function edit(store, siteId = HARBOR, changes = {}) {
  const board = store.getSnapshot();
  return {...siteFence(store, board, board.sites[siteId]), commandId: 'edit', row: 'Power', status: 'Ready',
    sourceAt: '2026-05-12T09:00:00', source: 'Northwind Power feed', ...changes};
}

/** Wait for the simulated service using the test clock rather than wall time. */
async function run(store, commandId, siteId = HARBOR, mode = 'run') {
  const result = runAssessment(store, {commandId, siteId, mode});
  await vi.advanceTimersByTimeAsync(700);
  return result;
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('working eligibility', () => {
  it('applies exact freshness and inclusive horizon boundaries without guessing missing rows', () => {
    const permit = {row: 'Permit', quality: 'Current', sourceAt: '2026-04-28T09:40:00'};
    expect(rowQuality(permit)).toBe('Current');
    expect(rowQuality({...permit, sourceAt: '2026-04-28T09:39:59'})).toBe('Stale');
    expect(rowQuality({...permit, quality: 'Conflicting', sourceAt: '2026-04-01T09:00:00'})).toBe('Conflicting');
    expect(rowQuality({...permit, sourceAt: null})).toBe('Missing');
    expect(['2026-05-11', '2026-05-12', '2026-06-02', '2026-06-03'].map(day => inHorizon(day))).toEqual([false, true, true, false]);
  });

  it('keeps bands, verification and approval separate and preserves baseline counts', () => {
    const board = makeBaseline();
    const civic = board.sites[CIVIC];
    expect(selectPortfolio(board).risk).toEqual({Green: 8, Amber: 5, Red: 3});
    expect(deriveReadiness(board.sites[MARKET])).toMatchObject({risk: 'Amber', mandatoryNotReady: false, mandatoryReady: false});
    expect(deriveReadiness(board.sites[EAST])).toMatchObject({risk: 'Amber', probability: null, confidence: 62});
    expect(deriveReadiness(board.sites['NRO-W-1851'])).toMatchObject({confidence: 54, reviewRequired: true});
    expect(deriveReadiness(board.sites['NRO-W-1838'])).toMatchObject({confidence: 70, reviewRequired: false});
    civic.rows.Power.status = 'In progress';
    expect(deriveReadiness(civic)).toMatchObject({risk: 'Green', ready: false, dispatchEligible: false});
    for (const [probability, confidence, risk, reviewRequired] of [[49, 75, 'Red', false], [50, 50, 'Amber', true], [80, 49, 'Red', true],
      [79, 75, 'Amber', false], [80, 74, 'Amber', false], [80, 75, 'Green', false], [80, 60, 'Amber', false]]) {
      civic.assessment = {...civic.assessment, probability, confidence};
      expect(deriveReadiness(civic)).toMatchObject({risk, reviewRequired});
    }
    civic.rows.Material.sourceAt = '2026-05-09T09:39:59';
    expect(deriveReadiness(civic, BOARD_AT, board.faults, board.audit.snapshots[civic.assessment.snapshotId])).toMatchObject({current: false, confidence: 49, risk: 'Red'});
    expect(civic.assessment.confidence).toBe(60);
  });
});

describe('evidence commands', () => {
  it('commits a dated observation, note and event without changing score history or hold', () => {
    const {store} = session();
    const before = store.getSnapshot();
    const input = edit(store, HARBOR, {note: 'Utility confirmed.'});
    expect(saveEvidence(store, input)).toEqual({ok: true, data: {siteRev: 1, evidenceRev: 1, assessmentState: 'needs_rescore', eventId: 'ev_edit'}});
    const next = store.getSnapshot();
    expect(next.sites[HARBOR].rows.Power).toMatchObject({status: 'Ready', quality: 'Current', sourceAt: input.sourceAt, ingestedAt: BOARD_AT});
    expect(next.sites[HARBOR].notes.at(-1)).toMatchObject({text: input.note, actorId: PERSON.elena});
    expect(next.sites[HARBOR].assessment).toEqual(before.sites[HARBOR].assessment);
    expect(next.audit.snapshots).toEqual(before.audit.snapshots);
    expect(next.audit.events.at(-1)).toMatchObject({verb: 'Evidence updated', row: 'Power'});
    expect(deriveReadiness(next.sites[HARBOR])).toMatchObject({risk: 'Amber', mandatoryReady: true, probability: null, dispatchEligible: false, disposition: 'Hold'});
    expect(selectPortfolio(next, {query: HARBOR}).visible[0]).toMatchObject({risk: 'Amber', assessment: null});
    expect(saveEvidence(store, input).ok).toBe(true);
    expect(store.getSnapshot()).toBe(next);
  });

  it('rejects invalid input, stale editors and unauthorized saves; a current replacement can resolve conflict', () => {
    const {store} = session();
    const before = store.getSnapshot();
    for (const changes of [{row: 'Unknown'}, {source: ' '}, {sourceAt: null}, {sourceAt: '2026-02-30T09:00:00'}, {sourceAt: '2026-05-12T09:40:01'}]) {
      expect(saveEvidence(store, edit(store, HARBOR, changes)).error.code).toBe('BAD_INPUT');
    }
    expect(store.getSnapshot()).toBe(before);
    const stale = edit(store, MARKET, {commandId: 'stale', row: 'Material'});
    expect(saveEvidence(store, {...stale, sourceAt: '2026-05-08T08:00:00'}).error.code).toBe('BAD_INPUT');
    expect(saveEvidence(store, edit(store, MARKET, {row: 'Material', source: 'Reconciled count'})).ok).toBe(true);
    expect(store.getSnapshot().sites[MARKET].rows.Material).toMatchObject({quality: 'Current', detail: null, observations: [{source: 'Reconciled count'}]});
    expect(saveEvidence(store, stale).error.code).toBe('STALE_INTENT');
    expect(switchUser(store, PERSON.priya).ok).toBe(true);
    expect(saveEvidence(store, edit(store, HARBOR, {commandId: 'denied'})).error.code).toBe('FORBIDDEN');
  });

  it('attaches only metadata and exact fixture text, rejecting conflicting MIME and rolling back quota errors', () => {
    const {store, failOn} = session();
    const before = store.getSnapshot();
    const file = {fileName: 'harbor-point-power-note.pdf', sizeBytes: 50, mediaType: 'application/pdf'};
    expect(attachEvidence(store, {...edit(store), ...file, mediaType: 'image/png'}).error.code).toBe('BAD_FILE');
    expect(attachEvidence(store, {...edit(store), ...file, fileName: 'scan.jpeg'}).error.code).toBe('BAD_FILE');
    expect(attachEvidence(store, {...edit(store), ...file, commandId: '1842_power'}).error.code).toBe('ID_CONFLICT');
    failOn('uploads');
    expect(attachEvidence(store, {...edit(store), ...file}).error.code).toBe('STORAGE_WRITE');
    expect(store.getSnapshot()).toBe(before);
    const result = attachEvidence(store, {...edit(store), ...file, bytes: [10, 20]});
    const next = store.getSnapshot();
    expect(next.uploads[result.data.uploadId]).toEqual({...file, id: 'doc_edit', siteId: HARBOR, row: 'Power', addedAt: BOARD_AT,
      addedBy: PERSON.elena, extractedText: before.uploads.doc_1842_power.extractedText, extractionState: 'available'});
    expect(next.sites[HARBOR]).toEqual({...before.sites[HARBOR], rev: 1});
    expect(next.audit.events.at(-1).verb).toBe('Document added');
    expect(attachEvidence(store, {...edit(store, HARBOR, {commandId: 'other'}), ...file, fileName: file.fileName.toUpperCase(), mediaType: ''}).data.extraction).toBe('failed');
    expect(store.getSnapshot().uploads.doc_other).toMatchObject({mediaType: 'application/pdf', extractedText: null});
  });
});

describe('assessment transaction', () => {
  it('waits 700 ms, suppresses duplicates and atomically appends immutable scored inputs', async () => {
    const {store} = session(PERSON.priya);
    const before = store.getSnapshot();
    const first = runAssessment(store, {commandId: 'one', siteId: HARBOR});
    expect((await runAssessment(store, {commandId: 'two', siteId: HARBOR})).error.code).toBe('SCORING');
    await vi.advanceTimersByTimeAsync(699);
    expect(store.getSnapshot()).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect((await first).data).toMatchObject({state: 'current', probability: 34, confidence: 86, scoredAt: BOARD_AT, correlationId: 'corr_1842_r1'});
    const next = store.getSnapshot();
    expect(next.audit.events.at(-1)).toMatchObject({verb: 'Scored', output: 34, snapshotId: 'snap_1842_r1'});
    expect(next.audit.snapshots.snap_1842_r1.rows).toHaveLength(6);
    expect(next.audit.snapshots.snap_1842_0934).toEqual(before.audit.snapshots.snap_1842_0934);
    expect(next.program.lastScore.snapshotId).toBe('snap_1842_r1');
    expect(next.program.morning).toEqual(before.program.morning);
    expect(await runAssessment(store, {commandId: 'one', siteId: HARBOR})).toEqual(await first);
    expect(store.getSnapshot()).toBe(next);
    expect((await run(store, 'east', EAST)).data).toMatchObject({state: 'unavailable', probability: null, confidence: 62, scoredAt: '2026-05-12T09:40:01'});
  });

  it('rejects unsupported evidence and inapplicable historical sites without a new score', async () => {
    const {store} = session();
    expect(saveEvidence(store, edit(store)).ok).toBe(true);
    const before = store.getSnapshot();
    expect((await run(store, 'unsupported')).data).toMatchObject({state: 'unsupported', scoredAt: '2026-05-12T09:34:00'});
    expect((await run(store, 'closed', 'NRO-W-1810')).data.state).toBe('inapplicable');
    expect((await run(store, 'dispatched', 'NRO-W-1822')).data.state).toBe('inapplicable');
    const next = store.getSnapshot();
    expect(next.audit.events.slice(-3).map(event => event.verb)).toEqual(Array(3).fill('Assessment not scored'));
    expect(next.audit.snapshots).toEqual(before.audit.snapshots);
    expect(next.sites[HARBOR].assessment).toEqual(before.sites[HARBOR].assessment);
    expect(next.sites['NRO-W-1810']).toEqual(before.sites['NRO-W-1810']);
    expect(next.sites['NRO-W-1822']).toEqual(before.sites['NRO-W-1822']);
  });

  it.each(['evidence', 'plan', 'faults', 'session', 'restore', 'navigation'])('discards stale completion after %s changes', async reason => {
    const {store} = session(reason === 'restore' ? PERSON.samira : PERSON.elena);
    const ctl = new AbortController();
    const attempt = runAssessment(store, {commandId: 'stale', siteId: HARBOR, signal: ctl.signal});
    if (reason === 'evidence') expect(saveEvidence(store, edit(store)).ok).toBe(true);
    if (reason === 'plan') expect(store.commit({commandId: 'move'}, board => {
      const site = board.sites[HARBOR];
      return {writes: {sites: {...board.sites, [HARBOR]: {...site, planRev: 1, plan: {...site.plan, plannedDay: '2026-05-19'}}}}};
    }).ok).toBe(true);
    if (reason === 'session') expect(switchUser(store, PERSON.priya).ok).toBe(true);
    if (reason === 'faults') expect(store.commit({commandId: 'fault'}, board => ({writes: {faults: {...board.faults, rev: 1, ddlOverride: 'Down'}}})).ok).toBe(true);
    if (reason === 'restore') expect(store.restore({commandId: 'reset', confirmed: true, expectedGeneration: 0}).ok).toBe(true);
    if (reason === 'navigation') ctl.abort();
    const beforeCallback = store.getSnapshot();
    await vi.advanceTimersByTimeAsync(700);
    expect((await attempt).error.code).toBe('STALE_INTENT');
    expect(store.getSnapshot()).toBe(beforeCallback);
  });

  it('retains score through Run and first Retry, then clears only the assessment outage', async () => {
    const {store} = session(PERSON.samira);
    expect(store.commit({commandId: 'interruption'}, board => ({writes: {faults: {...board.faults, rev: 1,
      assessmentDown: true, scenarioAssessmentDown: true, ddlOverride: 'Down', scenarioDdlDown: true, retryFailuresRemaining: 1}}})).ok).toBe(true);
    const before = store.getSnapshot();
    expect((await run(store, 'initial')).data.state).toBe('retained_outage');
    expect(store.getSnapshot().faults.retryFailuresRemaining).toBe(1);
    const outage = store.getSnapshot();
    expect(keepLastScore(store, {siteId: HARBOR}).data).toMatchObject({scoredAt: '2026-05-12T09:34:00', correlationId: 'corr_1842_a'});
    expect(store.getSnapshot()).toBe(outage);
    expect((await run(store, 'retry-1', HARBOR, 'retry')).data.state).toBe('retained_outage');
    expect(store.getSnapshot().faults.retryFailuresRemaining).toBe(0);
    expect(store.getSnapshot().audit.snapshots).toEqual(before.audit.snapshots);
    expect((await run(store, 'retry-2', HARBOR, 'retry')).data.state).toBe('current');
    const next = store.getSnapshot();
    expect(next.faults).toMatchObject({assessmentDown: false, scenarioAssessmentDown: false, ddlOverride: 'Down', scenarioDdlDown: true});
    expect(next.audit.events.slice(-3).map(event => event.verb)).toEqual(['Assessment failed', 'Assessment failed', 'Scored']);
    expect(next.program.failures).toEqual(before.program.failures);
  });

  it('recovers service without scoring when changed inputs lack a replay', async () => {
    const {store} = session();
    expect(saveEvidence(store, edit(store)).ok).toBe(true);
    expect(store.commit({commandId: 'interruption'}, board => ({writes: {faults: {...board.faults, rev: 1,
      scenarioAssessmentDown: true, scenarioDdlDown: true, retryFailuresRemaining: 0}}})).ok).toBe(true);
    const before = store.getSnapshot();
    expect((await run(store, 'recover', HARBOR, 'retry')).data.state).toBe('unsupported');
    expect(store.getSnapshot().faults).toMatchObject({scenarioAssessmentDown: false, scenarioDdlDown: true});
    expect(store.getSnapshot().program.lastScore).toEqual(before.program.lastScore);
    expect(store.getSnapshot().audit.snapshots).toEqual(before.audit.snapshots);
  });
});
