/** Exercise the real storage transaction, readiness thresholds and deterministic replay. */
import {createHash, webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {makeBaseline} from '../src/data/baseline.js';
import {PERSON} from '../src/data/people.js';
import {BOARD_AT} from '../src/data/register.js';
import {keepLastScore, runAssessment} from '../src/services/assessment.js';
import {attachEvidence, saveEvidence, siteFence} from '../src/services/evidence.js';
import {continueAs, INTENT, signOut, switchUser} from '../src/utils/access.js';
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
  const mutations = vi.fn();
  let failWrite = null;
  const store = createStore({getItem: key => records.get(key) ?? null, removeItem: key => {
    mutations('remove', key);
    records.delete(key);
  },
    setItem: (key, value) => {
      mutations('set', key);
      if (key === failWrite) { failWrite = null; throw new Error('Quota'); }
      records.set(key, value);
    }});
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, id).ok).toBe(true);
  return {store, records, mutations, failOn: key => { failWrite = `nro.demo.${key}`; }};
}

/** Assert that rejection leaves both the published board and persistent adapter untouched. */
async function expectNoWrites({store, records, mutations}, command, code) {
  const before = store.getSnapshot();
  const durable = new Map(records);
  const count = mutations.mock.calls.length;
  const result = command();
  await vi.advanceTimersByTimeAsync(700);
  expect(await result).toMatchObject({ok: false, error: {code}});
  expect(store.getSnapshot()).toBe(before);
  expect(records).toEqual(durable);
  expect(mutations).toHaveBeenCalledTimes(count);
}

/** Build the edit command from the actual committed site and session. */
function edit(store, siteId = HARBOR, changes = {}) {
  const board = store.getSnapshot();
  return {...siteFence(store, board, board.sites[siteId]), commandId: 'edit', row: 'Power', status: 'Ready',
    sourceAt: '2026-05-12T09:00:00', source: 'Northwind Power feed', ...changes};
}

/** Wait for the simulated service using the test clock rather than wall time. */
async function run(store, commandId, siteId = HARBOR, mode = 'run') {
  const result = runAssessment(store, {commandId, siteId, expectedSiteRev: store.getSnapshot().sites[siteId].rev, mode});
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
  it.each([
    ['Permit', '2026-04-28T09:40:00', '2026-04-28T09:39:59'],
    ['Civil', '2026-05-05T09:40:00', '2026-05-05T09:39:59'],
    ['Power', '2026-05-05T09:40:00', '2026-05-05T09:39:59'],
    ['Transmission', '2026-05-05T09:40:00', '2026-05-05T09:39:59'],
    ['Material', '2026-05-09T09:40:00', '2026-05-09T09:39:59'],
    ['Workforce', '2026-05-10T09:40:00', '2026-05-10T09:39:59'],
  ])('keeps %s current at its age limit and marks it stale one second later', (row, atLimit, oneSecondOlder) => {
    expect(rowQuality({row, quality: 'Current', sourceAt: atLimit}, BOARD_AT)).toBe('Current');
    expect(rowQuality({row, quality: 'Current', sourceAt: oneSecondOlder}, BOARD_AT)).toBe('Stale');
  });

  it.each([
    [49, 75, 'Red'], [50, 75, 'Amber'], [79, 75, 'Amber'], [80, 75, 'Green'],
    [80, 49, 'Red'], [80, 50, 'Amber'], [80, 74, 'Amber'],
  ])('classifies probability %i and confidence %i as %s', (probability, confidence, risk) => {
    const civic = makeBaseline().sites[CIVIC];
    civic.assessment = {...civic.assessment, probability, confidence};
    expect(deriveReadiness(civic)).toMatchObject({current: true, mandatoryReady: true, risk});
  });

  it.each([[59, true, false], [60, false, true]])('applies the separate review gate at %i%% confidence', (confidence, reviewRequired, dispatchEligible) => {
    const civic = makeBaseline().sites[CIVIC];
    civic.assessment = {...civic.assessment, probability: 80, confidence};
    expect(deriveReadiness(civic)).toMatchObject({risk: 'Amber', mandatoryReady: true, reviewRequired, dispatchEligible});
  });

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
  it.each(['commandId', 'siteId', 'expectedSiteRev', 'row', 'status', 'source', 'sourceAt'])(
    'rejects an evidence edit that omits %s before writing', async field => {
      const fixture = session();
      const input = edit(fixture.store);
      delete input[field];
      await expectNoWrites(fixture, () => saveEvidence(fixture.store, input), 'BAD_INPUT');
    },
  );

  it.each([
    ['commandId', 'BAD_INPUT'], ['siteId', 'BAD_INPUT'], ['expectedSiteRev', 'BAD_INPUT'], ['row', 'BAD_INPUT'],
    ['fileName', 'BAD_FILE'], ['sizeBytes', 'BAD_FILE'],
  ])('rejects an attachment that omits %s before writing', async (field, code) => {
    const fixture = session();
    const input = {...edit(fixture.store), fileName: 'scan.pdf', sizeBytes: 50};
    delete input[field];
    await expectNoWrites(fixture, () => attachEvidence(fixture.store, input), code);
  });

  it.each(['NRO-W-1810', 'NRO-W-1822'])('denies edits and attachments to historical site %s even for an Operator', async siteId => {
    const fixture = session();
    const input = edit(fixture.store, siteId);
    await expectNoWrites(fixture, () => saveEvidence(fixture.store, input), 'INAPPLICABLE');
    await expectNoWrites(fixture, () => attachEvidence(fixture.store, {...input, fileName: 'scan.pdf', sizeBytes: 50}), 'INAPPLICABLE');
  });

  it('stores an explicitly blank Unavailable observation as Missing and replays null with an omitted note', () => {
    const {store, mutations} = session();
    const input = edit(store, HARBOR, {status: 'Unavailable', sourceAt: '', note: '   '});
    const result = saveEvidence(store, input);
    expect(result.ok).toBe(true);
    const committed = store.getSnapshot();
    expect(committed.sites[HARBOR].rows.Power).toMatchObject({status: 'Unavailable', quality: 'Missing', sourceAt: null,
      note: null, observations: []});
    const calls = mutations.mock.calls.length;
    delete input.note;
    expect(saveEvidence(store, {...input, sourceAt: null})).toEqual(result);
    expect(store.getSnapshot()).toBe(committed);
    expect(mutations).toHaveBeenCalledTimes(calls);
  });

  it('replays normalized evidence and binds its receipt to a nonplaintext SHA-256 digest', () => {
    const {store, mutations} = session();
    const source = 'Utility dispatch clipboard 📋';
    const note = 'Power window confirmed; '.repeat(5).trim();
    const input = edit(store, HARBOR, {source: ` ${source} `, note: ` ${note} `});
    const result = saveEvidence(store, input);
    expect(result.ok).toBe(true);
    const committed = store.getSnapshot();
    const digest = createHash('sha256').update(JSON.stringify([HARBOR, input.row, input.expectedSiteRev,
      input.status, source, input.sourceAt, note])).digest('hex');
    expect(committed.audit.receipts[input.commandId].intentKey).toBe(`${INTENT.evidence}:sha256:${digest}`);
    const calls = mutations.mock.calls.length;
    expect(saveEvidence(store, {...input, source, note})).toEqual(result);
    expect(store.getSnapshot()).toBe(committed);
    expect(mutations).toHaveBeenCalledTimes(calls);
  });

  it.each([
    ['status', 'In progress'], ['source', 'Different source'], ['sourceAt', '2026-05-12T09:01:00'], ['note', 'Different note'],
  ])('rejects evidence command ID reuse with changed %s and no writes', async (field, value) => {
    const fixture = session();
    const input = edit(fixture.store, HARBOR, {note: 'Reconciled in the field'});
    expect(saveEvidence(fixture.store, input).ok).toBe(true);
    await expectNoWrites(fixture, () => saveEvidence(fixture.store, {...input, [field]: value}), 'ID_CONFLICT');
  });

  it('replays equivalent attachment metadata without persisting the filename in the receipt key', () => {
    const {store, mutations} = session();
    const input = {...edit(store), fileName: '  private scan.PDF  ', sizeBytes: 50};
    const result = attachEvidence(store, input);
    expect(result.ok).toBe(true);
    const committed = store.getSnapshot();
    const digest = createHash('sha256').update(JSON.stringify([HARBOR, input.row, input.expectedSiteRev,
      'private scan.PDF', input.sizeBytes, 'application/pdf', 'failed'])).digest('hex');
    expect(committed.audit.receipts[input.commandId].intentKey).toBe(`${INTENT.attach}:sha256:${digest}`);
    const calls = mutations.mock.calls.length;
    expect(attachEvidence(store, {...input, fileName: 'private scan.PDF', mediaType: 'APPLICATION/PDF'})).toEqual(result);
    expect(store.getSnapshot()).toBe(committed);
    expect(mutations).toHaveBeenCalledTimes(calls);
  });

  it.each([['fileName', 'other.pdf'], ['sizeBytes', 51], ['fileName', 'scan.jpg']])(
    'rejects attachment command ID reuse with changed %s (%j) and no writes', async (field, value) => {
      const fixture = session();
      const input = {...edit(fixture.store), fileName: 'scan.pdf', sizeBytes: 50};
      expect(attachEvidence(fixture.store, input).ok).toBe(true);
      await expectNoWrites(fixture, () => attachEvidence(fixture.store, {...input, [field]: value}), 'ID_CONFLICT');
    },
  );

  it('rejects reuse when equivalent stored filenames would produce different fixture extraction results', async () => {
    const fixture = session();
    const input = {...edit(fixture.store), fileName: 'harbor-point-power-note.pdf', sizeBytes: 50};
    expect(attachEvidence(fixture.store, input)).toMatchObject({ok: true, data: {extraction: 'available'}});
    await expectNoWrites(fixture, () => attachEvidence(fixture.store, {...input, fileName: ` ${input.fileName} `}), 'ID_CONFLICT');
  });

  it.each([
    ['row', 'Unknown'], ['status', 'Pending'], ['source', ''], ['source', '  '], ['source', 42],
    ['sourceAt', null], ['sourceAt', ''], ['sourceAt', '2026-05-12T09:00'], ['sourceAt', '2026-05-12T09:00:00Z'],
    ['sourceAt', '2026-02-30T09:00:00'], ['sourceAt', '2026-05-12T09:40:01'],
    ['expectedSiteRev', 0.5], ['siteId', null], ['commandId', ''],
  ])('rejects invalid %s (%j) without attempting persistent writes', async (field, value) => {
    const fixture = session();
    const input = edit(fixture.store, HARBOR, {[field]: value});
    await expectNoWrites(fixture, () => saveEvidence(fixture.store, input), 'BAD_INPUT');
  });

  it('trims source and note and accepts an observation at the exact board time', () => {
    const {store} = session();
    expect(saveEvidence(store, edit(store, HARBOR, {source: ' X ', note: ' Y ', sourceAt: BOARD_AT})).ok).toBe(true);
    expect(store.getSnapshot().sites[HARBOR].rows.Power).toMatchObject({source: 'X', note: 'Y', sourceAt: BOARD_AT});
  });

  it.each([['source', 120], ['note', 1000]])('accepts a trimmed %s of exactly %i Unicode code points and rejects one more', async (field, limit) => {
    const fixture = session();
    const {store} = fixture;
    const atLimit = '📋'.repeat(limit);
    await expectNoWrites(fixture, () => saveEvidence(store, edit(store, HARBOR, {[field]: ` ${atLimit}📋 `})), 'BAD_INPUT');
    expect(saveEvidence(store, edit(store, HARBOR, {[field]: ` ${atLimit} `})).ok).toBe(true);
    expect(store.getSnapshot().sites[HARBOR].rows.Power[field]).toBe(atLimit);
  });

  it('rejects both evidence mutations for an unknown, well-formed site ID', async () => {
    const fixture = session();
    const input = edit(fixture.store, HARBOR, {siteId: 'NRO-W-9999'});
    await expectNoWrites(fixture, () => saveEvidence(fixture.store, input), 'NOT_FOUND');
    await expectNoWrites(fixture, () => attachEvidence(fixture.store, {...input, fileName: 'scan.pdf', sizeBytes: 50, mediaType: 'application/pdf'}), 'NOT_FOUND');
  });

  it('rejects a Viewer edit and an otherwise valid attachment without durable writes', async () => {
    const fixture = session(PERSON.jordan);
    const input = edit(fixture.store);
    await expectNoWrites(fixture, () => saveEvidence(fixture.store, input), 'FORBIDDEN');
    await expectNoWrites(fixture, () => attachEvidence(fixture.store, {...input, fileName: 'scan.pdf', sizeBytes: 50, mediaType: 'application/pdf'}), 'FORBIDDEN');
  });

  it.each([
    ['fileName', ''], ['fileName', 'scan.jpeg'], ['fileName', 'nested/scan.pdf'], ['fileName', 'nested\\scan.pdf'], ['fileName', 'scan\u0000.pdf'],
    ['mediaType', 'image/png'], ['mediaType', 5],
    ['sizeBytes', -1], ['sizeBytes', 0.5], ['sizeBytes', '50'], ['sizeBytes', Infinity], ['sizeBytes', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects invalid attachment %s (%j) before any durable write', async (field, value) => {
    const fixture = session();
    const input = {...edit(fixture.store), fileName: 'scan.pdf', sizeBytes: 50, mediaType: 'application/pdf', [field]: value};
    await expectNoWrites(fixture, () => attachEvidence(fixture.store, input), 'BAD_FILE');
  });

  it.each([0, Number.MAX_SAFE_INTEGER])('accepts %i as a safe nonnegative attachment metadata byte count', sizeBytes => {
    const {store} = session();
    const result = attachEvidence(store, {...edit(store), fileName: 'scan.pdf', sizeBytes, mediaType: 'application/pdf'});
    expect(result.ok).toBe(true);
    expect(store.getSnapshot().uploads[result.data.uploadId].sizeBytes).toBe(sizeBytes);
  });

  it('accepts a trimmed filename of exactly 120 Unicode code points including the extension and rejects one more', async () => {
    const fixture = session();
    const {store} = fixture;
    const input = {...edit(store), sizeBytes: 50, mediaType: 'application/pdf'};
    const atLimit = `${'📋'.repeat(116)}.pdf`;
    await expectNoWrites(fixture, () => attachEvidence(store, {...input, fileName: ` 📋${atLimit} `}), 'BAD_FILE');
    const result = attachEvidence(store, {...input, fileName: ` ${atLimit} `});
    expect(result.ok).toBe(true);
    expect(store.getSnapshot().uploads[result.data.uploadId].fileName).toBe(atLimit);
  });

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
    const {store, failOn, records} = session();
    const before = store.getSnapshot();
    const durableBefore = new Map(records);
    const file = {fileName: 'harbor-point-power-note.pdf', sizeBytes: 50, mediaType: 'application/pdf'};
    expect(attachEvidence(store, {...edit(store), ...file, mediaType: 'image/png'}).error.code).toBe('BAD_FILE');
    expect(attachEvidence(store, {...edit(store), ...file, fileName: 'scan.jpeg'}).error.code).toBe('BAD_FILE');
    expect(attachEvidence(store, {...edit(store), ...file, commandId: '1842_power'}).error.code).toBe('ID_CONFLICT');
    failOn('uploads');
    expect(attachEvidence(store, {...edit(store), ...file}).error.code).toBe('STORAGE_WRITE');
    expect(store.getSnapshot()).toBe(before);
    expect(records).toEqual(durableBefore);
    const result = attachEvidence(store, {...edit(store), ...file, bytes: [10, 20]});
    const next = store.getSnapshot();
    expect(next.uploads[result.data.uploadId]).toEqual({...file, id: 'doc_edit', siteId: HARBOR, row: 'Power', addedAt: BOARD_AT,
      addedBy: PERSON.elena, extractedText: before.uploads.doc_1842_power.extractedText, extractionState: 'available'});
    expect(next.sites[HARBOR]).toEqual({...before.sites[HARBOR], rev: 1});
    expect(next.audit.events.at(-1).verb).toBe('Document added');
    expect(attachEvidence(store, {...edit(store, HARBOR, {commandId: 'other'}), ...file, fileName: file.fileName.toUpperCase(), mediaType: ''}).data.extraction).toBe('failed');
    expect(store.getSnapshot().uploads.doc_other).toMatchObject({mediaType: 'application/pdf', extractedText: null});
    const padded = attachEvidence(store, {...edit(store, HARBOR, {commandId: 'padded'}), ...file, fileName: ` ${file.fileName} `});
    expect(padded.data.extraction).toBe('failed');
    expect(store.getSnapshot().uploads.doc_padded.fileName).toBe(file.fileName);
  });
});

describe('assessment transaction', () => {
  it.each(['commandId', 'siteId', 'expectedSiteRev'])('rejects an assessment that omits %s without writing', async field => {
    const fixture = session();
    const input = {commandId: 'replay', siteId: HARBOR, expectedSiteRev: 0};
    delete input[field];
    await expectNoWrites(fixture, () => runAssessment(fixture.store, input), 'BAD_INPUT');
  });

  it('rejects a pre-aborted assessment immediately without reserving a scoring slot or writing', async () => {
    const fixture = session();
    const {store} = fixture;
    const controller = new AbortController();
    controller.abort();
    const timers = vi.getTimerCount();
    await expectNoWrites(fixture, () => {
      const attempt = runAssessment(store, {commandId: 'aborted', siteId: HARBOR, expectedSiteRev: 0, signal: controller.signal});
      expect(vi.getTimerCount()).toBe(timers);
      return attempt;
    }, 'STALE_INTENT');
    expect((await run(store, 'next')).ok).toBe(true);
  });

  it('denies Keep for missing sites and signed-out callers without writing', async () => {
    const fixture = session();
    const {store} = fixture;
    await expectNoWrites(fixture, () => keepLastScore(store, {siteId: 'NRO-W-9999'}), 'NOT_FOUND');
    expect(signOut(store).ok).toBe(true);
    await expectNoWrites(fixture, () => keepLastScore(store, {siteId: HARBOR}), 'FORBIDDEN');
  });

  it.each([
    ['commandId', '', 'BAD_INPUT'], ['mode', 'refresh', 'BAD_INPUT'], ['siteId', 1842, 'BAD_INPUT'],
    ['siteId', 'NRO-W-9999', 'NOT_FOUND'], ['expectedSiteRev', 1, 'STALE_INTENT'],
    ['expectedSiteRev', -1, 'BAD_INPUT'], ['expectedSiteRev', 0.5, 'BAD_INPUT'], ['expectedSiteRev', '0', 'BAD_INPUT'],
    ['expectedSiteRev', Number.MAX_SAFE_INTEGER + 1, 'BAD_INPUT'],
  ])('rejects replay with %s=%j (%s) without changing durable state', async (field, value, code) => {
    const fixture = session();
    await expectNoWrites(fixture, () => runAssessment(fixture.store, {commandId: 'replay', siteId: HARBOR, expectedSiteRev: 0, [field]: value}), code);
  });

  it.each(['run', 'retry'])('rejects Viewer %s even when the command has an existing receipt', async mode => {
    const fixture = session();
    expect((await run(fixture.store, 'replay', HARBOR, mode)).ok).toBe(true);
    expect(switchUser(fixture.store, PERSON.jordan).ok).toBe(true);
    await expectNoWrites(fixture, () => runAssessment(fixture.store, {commandId: 'replay', siteId: HARBOR, expectedSiteRev: 0, mode}), 'FORBIDDEN');
  });

  it('waits 700 ms, suppresses duplicates and atomically appends immutable scored inputs', async () => {
    const {store} = session(PERSON.priya);
    const before = store.getSnapshot();
    const first = runAssessment(store, {commandId: 'one', siteId: HARBOR, expectedSiteRev: 0});
    expect((await runAssessment(store, {commandId: 'two', siteId: HARBOR, expectedSiteRev: 0})).error.code).toBe('SCORING');
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
    expect((await run(store, 'east', EAST)).data).toMatchObject({state: 'unavailable', probability: null, confidence: 62, scoredAt: '2026-05-12T09:40:01'});
  });

  it('replays the original receipt after the site advances and rejects changes to revision, mode or site', async () => {
    const fixture = session();
    const {store, records, mutations} = fixture;
    const input = {commandId: 'replay', siteId: HARBOR, expectedSiteRev: 0};
    const first = runAssessment(store, input);
    await vi.advanceTimersByTimeAsync(700);
    const original = await first;
    expect(original.ok).toBe(true);
    const next = store.getSnapshot();
    expect(next.sites[HARBOR].rev).toBe(1);
    const durable = new Map(records);
    const count = mutations.mock.calls.length;
    expect(await runAssessment(store, input)).toEqual(original);
    expect(await runAssessment(store, {...input, mode: 'run'})).toEqual(original);
    expect(store.getSnapshot()).toBe(next);
    expect(records).toEqual(durable);
    expect(mutations).toHaveBeenCalledTimes(count);
    for (const changes of [{expectedSiteRev: 1}, {expectedSiteRev: 2}, {mode: 'retry'}, {siteId: EAST}]) {
      await expectNoWrites(fixture, () => runAssessment(store, {...input, ...changes}), 'ID_CONFLICT');
    }
    await expectNoWrites(fixture, () => runAssessment(store, {commandId: input.commandId, siteId: HARBOR}), 'BAD_INPUT');

    const followup = {...input, commandId: 'followup', expectedSiteRev: 1};
    const pending = runAssessment(store, followup);
    expect(await runAssessment(store, input)).toEqual(original);
    expect((await runAssessment(store, {...input, expectedSiteRev: 1})).error.code).toBe('ID_CONFLICT');
    expect((await runAssessment(store, followup)).error.code).toBe('SCORING');
    expect(mutations).toHaveBeenCalledTimes(count);
    await vi.advanceTimersByTimeAsync(700);
    expect((await pending).ok).toBe(true);
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
    const attempt = runAssessment(store, {commandId: 'stale', siteId: HARBOR, expectedSiteRev: 0, signal: ctl.signal});
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
