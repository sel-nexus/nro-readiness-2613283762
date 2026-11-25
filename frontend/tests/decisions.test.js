/** Exercise decision boundaries through the real journaled workshop store. */
import {createHash, webcrypto} from 'node:crypto';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {PERSON} from '../src/data/people.js';
import {assignOwner, decide, executeField, fieldConfirmation, precautionaryHold, previewApproval, previewField, rank,
  recordApprovalDenial, requestRefresh, siteAudit} from '../src/services/decisions.js';
import {saveEvidence, siteFence} from '../src/services/evidence.js';
import {continueAs, readAccess, switchUser} from '../src/utils/access.js';
import {deriveReadiness} from '../src/utils/readiness.js';
import {createStore} from '../src/utils/storage.js';

const HARBOR = 'NRO-W-1842';
const CIVIC = 'NRO-W-1847';
const LAKESIDE = 'NRO-W-1851';
const PORT = 'NRO-W-1866';
const SPARE = 'opt_1842_north_gate';
const REASON = 'The confirmed utility window avoids a wasted crew visit.';
const REVIEW_AGAIN = 'Board or access changed. Review and confirm again.';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

/** Seed an isolated workshop and optionally fail one transactional write. */
function open(actor) {
  let failKey;
  const records = new Map();
  const mutations = vi.fn();
  const store = createStore({getItem: key => records.get(key) ?? null, removeItem: key => {
    mutations('remove', key);
    records.delete(key);
  },
    setItem: (key, value) => {
      mutations('set', key);
      if (key === failKey) { failKey = null; throw new Error('Quota simulated'); }
      records.set(key, value);
    }});
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, actor).ok).toBe(true);
  return {store, records, mutations, failOn: key => { failKey = `nro.demo.${key}`; }};
}

/** Verify rejection without publishing a board or touching the storage journal. */
function expectNoWrites({store, records, mutations}, run, code, message) {
  const before = store.getSnapshot();
  const durable = new Map(records);
  const writeCount = mutations.mock.calls.length;
  expect(run()).toEqual({ok: false, error: {code, message}});
  expect(store.getSnapshot()).toBe(before);
  expect(records).toEqual(durable);
  expect(mutations).toHaveBeenCalledTimes(writeCount);
}

/** Construct an explicit proposal command from a captured committed review. */
function review(store, siteId, commandId, verb, optionId = null) {
  const board = store.getSnapshot();
  const site = board.sites[siteId];
  const preview = previewApproval(site, optionId);
  return {...siteFence(store, board, site), commandId, proposalId: site.proposal.id, optionId,
    reviewKey: preview.reviewKey, expectedFaultRev: board.faults.rev,
    reviewedAssignmentRev: board.program.crew.find(item => item.id === preview.scope?.assignmentId)?.rev ?? null, verb, rationale: REASON};
}

/** Preview the current field state as the actual stored persona. */
function field(store, siteId, action) {
  const board = store.getSnapshot();
  const site = board.sites[siteId];
  const field = previewField(board, site, readAccess(board));
  return action ? fieldConfirmation(store, board, site, field, action) : field;
}

it('ranks Harbor Power alone, preserves North Gate civil watch, and does not turn disputed/missing evidence into blockers', () => {
  const {store} = open(PERSON.elena);
  const board = store.getSnapshot();
  const ranks = id => rank(board.sites[id], deriveReadiness(board.sites[id]));
  expect(ranks(HARBOR)).toEqual([expect.objectContaining({row: 'Power', kind: 'blocker', ownerId: PERSON.ruth, window: '15 May if the cutover holds'})]);
  expect(ranks('NRO-W-1878')).toEqual([expect.objectContaining({row: 'Civil', kind: 'watch'})]);
  expect(ranks('NRO-W-1860')).toEqual([expect.objectContaining({row: 'Workforce', kind: 'repair'})]);
  expect(ranks('NRO-W-1855')).toEqual([expect.objectContaining({row: 'Material', kind: 'repair'})]);
  expect(ranks('NRO-W-1872')[0]).toMatchObject({row: 'Transmission', kind: 'repair'});
  expect(ranks(PORT)[0]).toMatchObject({row: 'Power', kind: 'pending'});
  expect(store.getSnapshot()).toBe(board);
});

it('approves Portside in one transaction, preserves evidence and crew, and gives Andre no dispatch or resequence execution', () => {
  const {store} = open(PERSON.priya);
  const before = store.getSnapshot();
  const input = review(store, PORT, 'approve-port', 'approve');
  expect(previewApproval(before.sites[PORT]).after).toMatchObject({supplierId: 'civic', agreementId: 'AGR-CC-1844', plannedDay: '2026-05-19'});
  expect(before.sites[PORT].plan).toMatchObject({supplierId: 'northwind', plannedDay: '2026-05-15'});
  const result = decide(store, input);
  expect(result).toMatchObject({ok: true, data: {disposition: 'Approved — resequence', workflowId: 'ECO-1866-1'}});
  expect(decide(store, input)).toEqual(result);
  const board = store.getSnapshot();
  expect(board.sites[PORT]).toMatchObject({planRev: 1, scoreState: 'needs_rescore', rows: before.sites[PORT].rows, executions: []});
  const persistedPlan = {supplierId: 'civic', agreementId: 'AGR-CC-1844', plannedDay: '2026-05-19', closedAt: null};
  expect(board.sites[PORT].plan).toEqual(persistedPlan);
  const scope = {kind: 'resequence', plannedDay: '2026-05-19', supplierId: 'civic', agreementId: 'AGR-CC-1844'};
  expect(board.sites[PORT].decisions[0].scope).toEqual(scope);
  expect(board.sites[PORT].decisions[0].after).toEqual(persistedPlan);
  expect(board.program.eco[result.data.workflowId].scope).toEqual(scope);
  expect(store.recover().ok).toBe(true);
  expect(store.getSnapshot().sites[PORT].plan).toEqual(persistedPlan);
  expect(board.sites[PORT].rows.Power.status).toBe('In progress');
  expect(board.program.crew).toEqual(before.program.crew);
  expect(Object.values(board.program.eco)).toEqual([expect.objectContaining({decisionId: result.data.decisionId, siteId: PORT, state: 'Queued'})]);
  expect(siteAudit(board, PORT)[0]).toMatchObject({verb: 'Approval', rationale: REASON, snapshotId: 'snap_1866_0934', output: 58});
  expect(switchUser(store, PERSON.andre).ok).toBe(true);
  expect(field(store, PORT).approvals).toMatchObject({dispatch: null, resequence: null});
  expect(field(store, PORT, 'dispatch')).toBeNull();
});

it('rolls back plan, audit and ECO when a transaction write fails', () => {
  const {store, failOn} = open(PERSON.priya);
  const before = store.getSnapshot();
  failOn('program');
  expect(decide(store, review(store, PORT, 'failed-approval', 'approve'))).toMatchObject({ok: false, error: {code: 'STORAGE_WRITE'}});
  expect(store.recover().ok).toBe(true);
  expect(store.getSnapshot()).toEqual(before);
});

it.each(['reject', 'modify'])('%s preserves the Portside baseline and creates no workflow', verb => {
  const {store} = open(PERSON.priya);
  const before = store.getSnapshot();
  const result = decide(store, {...review(store, PORT, verb, verb), ownerId: PERSON.ruth, dueDay: '2026-05-14', note: 'Recheck power.'});
  expect(result).toMatchObject({ok: true, data: {workflowId: null, disposition: verb === 'reject' ? 'Rejected' : 'Modified'}});
  const board = store.getSnapshot();
  expect(board.sites[PORT]).toMatchObject({plan: before.sites[PORT].plan, planRev: 0, executions: []});
  expect(board.program).toEqual(before.program);
  expect(siteAudit(board, PORT)[0].detail).toContain(verb === 'reject' ? 'Rejected by Priya Raman' : 'Modified by Priya Raman');
  if (verb === 'modify') expect(board.sites[PORT].proposal).toMatchObject({ownerId: PERSON.ruth, dueDay: '2026-05-14', note: 'Recheck power.'});
});

it('does not audit Priya validation failures or allow arbitrary options or changed review keys', () => {
  const {store} = open(PERSON.priya);
  const before = store.getSnapshot();
  const input = review(store, PORT, 'invalid', 'approve');
  expect(decide(store, {...input, rationale: '  12345678901  '}).error.code).toBe('BAD_RATIONALE');
  expect(decide(store, {...input, reviewKey: 'different'}).error.code).toBe('STALE_INTENT');
  expect(decide(store, review(store, PORT, 'wrong-site', 'approve', SPARE)).error.code).toBe('STALE_INTENT');
  expect(store.getSnapshot()).toEqual(before);
});

it.each(['approve', 'reject', 'modify', 'override'])('rejects %s with the rationale omitted without writing', verb => {
  const fixture = open(PERSON.priya);
  const {store} = fixture;
  const valid = review(store, PORT, 'missing-rationale', verb);
  if (verb === 'modify') Object.assign(valid, {ownerId: PERSON.ruth, dueDay: '2026-05-14', note: 'Recheck power.'});
  const missing = {...valid};
  delete missing.rationale;

  expectNoWrites(fixture, () => decide(store, missing), 'BAD_RATIONALE', 'Enter a rationale of at least 12 characters.');
  expect(decide(store, valid).ok).toBe(true);
});

it.each(['ownerId', 'dueDay', 'note'])('rejects a modification with %s omitted without writing', key => {
  const fixture = open(PERSON.priya);
  const {store} = fixture;
  const valid = {...review(store, PORT, 'missing-modification-field', 'modify'),
    ownerId: PERSON.ruth, dueDay: '2026-05-14', note: 'Recheck power.'};
  const missing = {...valid};
  delete missing[key];

  expectNoWrites(fixture, () => decide(store, missing), 'BAD_MODIFICATION',
    'Choose an owner and valid due date, and enter a short note.');
  expect(decide(store, valid).ok).toBe(true);
});

it.each([
  ['commandId', 'BAD_INPUT', 'Invalid board command.'],
  ...['verb', 'siteId', 'expectedSiteRev', 'expectedGeneration', 'expectedSessionToken', 'expectedSessionEpoch']
    .map(key => [key, 'BAD_INPUT', REVIEW_AGAIN]),
  ...['proposalId', 'optionId', 'reviewKey', 'expectedFaultRev', 'reviewedAssignmentRev']
    .map(key => [key, 'STALE_INTENT', REVIEW_AGAIN]),
])('rejects a spare-slot approval with %s omitted without writing', (key, code, message) => {
  const fixture = open(PERSON.priya);
  const {store} = fixture;
  const valid = review(store, HARBOR, 'missing-decision-field', 'approve', SPARE);
  const missing = {...valid};
  delete missing[key];

  expectNoWrites(fixture, () => decide(store, missing), code, message);
  expect(decide(store, valid).ok).toBe(true);
});

it.each([[11, false], [12, true], [1000, true], [1001, false]])('validates %i trimmed Unicode rationale characters', (length, valid) => {
  const {store} = open(PERSON.priya);
  const before = store.getSnapshot();
  const rationale = '🔧'.repeat(length);
  const input = {...review(store, PORT, 'rationale-boundary', 'approve'), rationale: `\u2003${rationale}\t`};
  const result = decide(store, input);
  if (!valid) {
    expect(result).toMatchObject({ok: false, error: {code: 'BAD_RATIONALE'}});
    expect(store.getSnapshot()).toEqual(before);
    return;
  }
  expect(result.ok).toBe(true);
  const board = store.getSnapshot();
  expect(board.sites[PORT].decisions[0].rationale).toBe(rationale);
  expect(siteAudit(board, PORT)[0].rationale).toBe(rationale);
});

it.each([[1000, true], [1001, false]])('validates %i trimmed Unicode modification note characters', (length, valid) => {
  const {store} = open(PERSON.priya);
  const before = store.getSnapshot();
  const note = '🔧'.repeat(length);
  const result = decide(store, {...review(store, PORT, 'note-boundary', 'modify'),
    ownerId: PERSON.ruth, dueDay: '2026-05-14', note: `\u2003${note}\t`});
  if (!valid) {
    expect(result).toMatchObject({ok: false, error: {code: 'BAD_MODIFICATION'}});
    expect(store.getSnapshot()).toEqual(before);
    return;
  }
  expect(result.ok).toBe(true);
  const site = store.getSnapshot().sites[PORT];
  expect(site.decisions[0].note).toBe(note);
  expect(site.proposal.note).toBe(note);
});

it.each([
  ['owner', {ownerId: 'random'}],
  ['impossible date', {dueDay: '2026-05-32'}],
  ['past date', {dueDay: '2026-05-11'}],
  ['blank note', {note: '   '}],
])('rejects an otherwise valid modification with an invalid %s', (_label, invalid) => {
  const {store} = open(PERSON.priya);
  const before = store.getSnapshot();
  const valid = {...review(store, PORT, 'modify-validation', 'modify'), ownerId: PERSON.ruth, dueDay: '2026-05-14', note: 'Recheck power.'};
  expect(decide(store, {...valid, ...invalid}).error.code).toBe('BAD_MODIFICATION');
  expect(store.getSnapshot()).toEqual(before);
  expect(decide(store, valid).ok).toBe(true);
});

it('replays a normalized approval and rejects reuse for changed decision intent', () => {
  const {store} = open(PERSON.priya);
  const input = review(store, HARBOR, 'reuse-approval', 'approve');
  const spare = review(store, HARBOR, input.commandId, 'approve', SPARE);
  const result = decide(store, input);
  expect(result.ok).toBe(true);
  const after = store.getSnapshot();
  expect(store.recover().ok).toBe(true);
  expect(decide(store, {...input, rationale: `  ${REASON}\n`, confidenceReviewed: false})).toEqual(result);
  for (const changed of [spare, {...input, rationale: 'A completely different rationale.'}, {...input, rationale: ''},
    {...input, reviewKey: 'different review'}, {...input, verb: 'reject'}, {...input, confidenceReviewed: true},
    {...input, expectedFaultRev: input.expectedFaultRev + 1}, {...input, reviewedAssignmentRev: 1}]) {
    expect(decide(store, changed).error.code).toBe('ID_CONFLICT');
  }
  expect(store.getSnapshot()).toEqual(after);
  expect(after.sites[HARBOR].decisions).toEqual([expect.objectContaining({rationale: REASON})]);
  expect(after.sites[HARBOR].decisions[0].scope).toEqual({kind: 'hold'});
  expect(after.program.eco[result.data.workflowId].scope).toEqual({kind: 'hold'});
});

it('replays the trimmed modification but rejects changed note, owner or due date without writing', () => {
  const {store} = open(PERSON.priya);
  const input = {...review(store, PORT, 'reuse-modification', 'modify'),
    ownerId: PERSON.ruth, dueDay: '2026-05-14', note: 'Recheck the power schedule. 🔧'};
  const result = decide(store, {...input, note: `  ${input.note}\n`});
  expect(result.ok).toBe(true);
  const after = store.getSnapshot();
  const receipt = after.audit.receipts[input.commandId];
  const digest = createHash('sha256').update(JSON.stringify([
    input.commandId, input.verb, input.siteId, input.expectedSiteRev,
    input.proposalId, input.optionId, input.reviewKey, input.expectedFaultRev,
    input.reviewedAssignmentRev, false, input.rationale, input.ownerId, input.dueDay, input.note,
  ])).digest('hex');
  expect(receipt.intentKey).toBe(`decision:sha256:${digest}`);
  expect(JSON.stringify(receipt)).not.toContain(input.rationale);
  expect(JSON.stringify(receipt)).not.toContain(input.note);
  expect(decide(store, input)).toEqual(result);
  for (const change of [{note: 'Recheck the supplier agreement.'}, {ownerId: PERSON.denise}, {dueDay: '2026-05-15'}]) {
    expect(decide(store, {...input, ...change}).error.code).toBe('ID_CONFLICT');
  }
  expect(store.getSnapshot()).toEqual(after);
});

it.each([
  ['extra hold payload', {kind: 'hold', plannedDay: '2026-05-21'}],
  ['wrong supplier agreement', {kind: 'resequence', plannedDay: '2026-05-21', supplierId: 'civic', agreementId: 'AGR-NW-2291'}],
  ['slot without assignment', {kind: 'resequence', plannedDay: '2026-05-21', shiftAt: '2026-05-21T07:00:00'}],
  ['slot not on planned day', {kind: 'resequence', plannedDay: '2026-05-21', assignmentId: 'crew_1842', crewLeadId: PERSON.luis, crewSize: 4, shiftAt: '2026-05-22T07:00:00'}],
])('does not approve a proposal with %s', (_label, payload) => {
  const {store} = open(PERSON.priya);
  expect(store.commit({commandId: 'change-scope'}, board => {
    const site = board.sites[HARBOR];
    return {writes: {sites: {...board.sites, [HARBOR]: {...site, rev: site.rev + 1, proposal: {...site.proposal, payload}}}}};
  }).ok).toBe(true);
  const before = store.getSnapshot();
  expect(previewApproval(before.sites[HARBOR])).toMatchObject({eligible: false, scope: null});
  expect(decide(store, review(store, HARBOR, 'approve-invalid-scope', 'approve')).error.code).toBe('STALE_INTENT');
  expect(store.getSnapshot()).toEqual(before);
});

it.each([
  ['missing', crew => crew.filter(item => item.siteId !== HARBOR)],
  ['revised', crew => crew.map(item => item.siteId === HARBOR ? {...item, rev: item.rev + 1} : item)],
])('does not approve the spare slot with a %s reviewed assignment', (_label, change) => {
  const {store} = open(PERSON.priya);
  const input = review(store, HARBOR, 'approve-changed-assignment', 'approve', SPARE);
  expect(input.reviewedAssignmentRev).toBe(0);
  expect(store.commit({commandId: 'change-assignment'}, board => ({writes: {program: {...board.program,
    crew: change(board.program.crew)}}})).ok).toBe(true);
  const before = store.getSnapshot();
  expect(decide(store, input).error.code).toBe('STALE_INTENT');
  expect(store.getSnapshot()).toEqual(before);
});

it('requires explicit confidence review for a low-confidence schedule change without turning it into dispatch approval', () => {
  const fixture = open(PERSON.priya);
  const {store} = fixture;
  expect(store.commit({commandId: 'lower-confidence'}, board => ({writes: {sites: {...board.sites,
    [PORT]: {...board.sites[PORT], rev: 1, assessment: {...board.sites[PORT].assessment, confidence: 59}}}}})).ok).toBe(true);
  const valid = {...review(store, PORT, 'low-confidence-approval', 'approve'), confidenceReviewed: true};
  const missing = {...valid};
  delete missing.confidenceReviewed;
  expectNoWrites(fixture, () => decide(store, missing), 'REVIEW_REQUIRED', 'Confirm that you reviewed the evidence and confidence.');
  expect(decide(store, valid).ok).toBe(true);
  expect(store.getSnapshot().sites[PORT].decisions[0]).toMatchObject({confidenceReviewed: true, scope: {kind: 'resequence'}});
  expect(switchUser(store, PERSON.andre).ok).toBe(true);
  expect(field(store, PORT, 'dispatch')).toBeNull();
});

it('records a redacted denial once and makes the denial entry point inoperable for Priya', () => {
  const {store} = open(PERSON.jordan);
  const before = store.getSnapshot();
  const input = review(store, PORT, 'denied', 'approve');
  const result = decide(store, {...input, rationale: 'Private attempted text'});
  expect(result).toMatchObject({ok: false, error: {code: 'FORBIDDEN', message: expect.stringContaining('Regional Viewer')}});
  expect(recordApprovalDenial(store, {...input, attempt: 'approve'})).toEqual(result);
  const board = store.getSnapshot();
  expect(board.sites).toEqual(before.sites);
  expect(board.program).toEqual(before.program);
  expect(board.audit.events.length).toBe(before.audit.events.length + 1);
  expect(siteAudit(board, PORT)[0]).toMatchObject({verb: 'Approval denied', attemptedVerb: 'approve', actorId: PERSON.jordan, reasonCode: 'FORBIDDEN'});
  expect(siteAudit(board, PORT)[0]).not.toHaveProperty('snapshotId');
  expect(JSON.stringify(board.audit)).not.toContain('Private attempted text');
  expect(switchUser(store, PERSON.priya).ok).toBe(true);
  expect(recordApprovalDenial(store, {...review(store, PORT, 'no-denial', 'approve'), attempt: 'approve'}).error.code).toBe('FORBIDDEN');
  expect(store.getSnapshot().audit.events).toEqual(board.audit.events);
});

it('records once-only assign, local refresh and precautionary hold without changing evidence or crew', () => {
  const {store} = open(PERSON.elena);
  const before = store.getSnapshot();
  expect(precautionaryHold(store, review(store, HARBOR, 'already-held')).error.message).toContain('already in effect');
  expect(precautionaryHold(store, review(store, PORT, 'consequential')).error.message).toContain('Approval');
  expect(requestRefresh(store, {...review(store, LAKESIDE, 'wrong-row'), row: 'Power'}).error.code).toBe('STALE_INTENT');
  expect(assignOwner(store, review(store, LAKESIDE, 'assign')).data.ownerId).toBe(PERSON.denise);
  expect(assignOwner(store, review(store, LAKESIDE, 'assign-again')).error.message).toContain('already assigned');
  expect(requestRefresh(store, {...review(store, LAKESIDE, 'refresh'), row: 'Permit'}).ok).toBe(true);
  expect(precautionaryHold(store, review(store, LAKESIDE, 'hold')).ok).toBe(true);
  const board = store.getSnapshot();
  expect(siteAudit(board, LAKESIDE).slice(0, 4).map(event => event.verb)).toEqual(['Precautionary hold', 'Evidence refresh requested', 'Owner assigned', 'Recommended']);
  expect(board.sites[LAKESIDE]).toMatchObject({holdActive: true, disposition: 'Hold', evidenceRev: 0, rows: before.sites[LAKESIDE].rows,
    plan: before.sites[LAKESIDE].plan, decisions: [], executions: []});
  expect(board.program).toEqual(before.program);
});

it('records an explicit override with frozen assessed context and keeps an approved hold from becoming dispatch', () => {
  const {store} = open(PERSON.priya);
  expect(decide(store, review(store, HARBOR, 'override', 'override')).ok).toBe(true);
  let board = store.getSnapshot();
  expect(board.sites[HARBOR].decisions[0]).toMatchObject({priorDisposition: 'Hold', disposition: 'Approved — hold', assessmentRef: 'snap_1842_0934'});
  expect(siteAudit(board, HARBOR)[0]).toMatchObject({verb: 'Override', confidence: 86, rationale: REASON});
  expect(switchUser(store, PERSON.elena).ok).toBe(true);
  expect(saveEvidence(store, {...review(store, HARBOR, 'edit'), row: 'Power', status: 'Ready', source: 'Updated evidence', sourceAt: '2026-05-12T09:00:00'}).ok).toBe(true);
  board = store.getSnapshot();
  expect(board.sites[HARBOR].rows.Power.status).toBe('Ready');
  expect(board.audit.snapshots.snap_1842_0934.rows.find(row => row.row === 'Power').status).toBe('Not Ready');
  expect(Object.isFrozen(board.audit.snapshots.snap_1842_0934.rows)).toBe(true);
  expect(switchUser(store, PERSON.andre).ok).toBe(true);
  expect(field(store, HARBOR, 'dispatch')).toBeNull();
  expect(field(store, HARBOR, 'hold')).toBeNull();
});

it('dispatches Civic Center exactly once under the exact legacy approval and records working versus assessed context', () => {
  const {store} = open(PERSON.andre);
  const before = store.getSnapshot();
  const input = {...field(store, CIVIC, 'dispatch'), commandId: 'dispatch'};
  expect(input.approvalId).toBe('approval_1847_0511');
  expect(executeField(store, {...input, approvalId: 'not-the-reviewed-approval'}).error.code).toBe('STALE_INTENT');
  const result = executeField(store, input);
  expect(result).toMatchObject({ok: true, data: {disposition: 'Dispatched'}});
  expect(executeField(store, input)).toEqual(result);
  expect(executeField(store, {...input, approvalId: 'not-the-reviewed-approval'}).error.code).toBe('ID_CONFLICT');
  expect(executeField(store, {...input, commandId: 'duplicate'}).ok).toBe(false);
  const board = store.getSnapshot();
  expect(board.sites[CIVIC]).toMatchObject({lifecycle: 'dispatched', plan: before.sites[CIVIC].plan, executions: [{approvalId: input.approvalId, evidenceRev: 0}]});
  expect(board.program.crew.find(item => item.siteId === CIVIC).state).toBe('Dispatched');
  expect(board.program.eco).toEqual(before.program.eco);
  expect(board.program.failures).toEqual(before.program.failures);
  expect(siteAudit(board, CIVIC).filter(item => item.verb === 'Dispatched')).toEqual([
    expect.objectContaining({decisionId: input.approvalId, snapshotId: 'snap_1847_0511', executionEvidenceRev: 0}),
  ]);
});

it.each([
  ['commandId', 'Invalid board command.'],
  ...['action', 'siteId', 'expectedSiteRev', 'expectedGeneration', 'expectedSessionToken', 'expectedSessionEpoch',
    'assignmentId', 'assignmentRev', 'approvalId', 'expectedFaultRev'].map(key => [key, REVIEW_AGAIN]),
])('rejects a dispatch confirmation with %s omitted without writing', (key, message) => {
  const fixture = open(PERSON.andre);
  const {store} = fixture;
  const valid = {...field(store, CIVIC, 'dispatch'), commandId: 'missing-field-confirmation'};
  const missing = {...valid};
  delete missing[key];

  expectNoWrites(fixture, () => executeField(store, missing), 'BAD_INPUT', message);
  expect(executeField(store, valid).ok).toBe(true);
});

it('blocks field actions across persona or assignment changes and explains fixture-specific safety denials', () => {
  const {store} = open(PERSON.andre);
  const input = {...field(store, CIVIC, 'dispatch'), commandId: 'stale-dispatch'};
  expect(Object.values(field(store, 'NRO-W-1860').reasons).every(reason => reason.includes('Confidence is 48%'))).toBe(true);
  expect(field(store, 'NRO-W-1834').reasons.dispatch).toContain('No dispatch-specific approval');
  expect(field(store, 'NRO-W-1855').reasons.dispatch).toContain('mandatory evidence');
  expect(field(store, HARBOR).holdReason).toBe('Power is Not Ready and the site is on hold.');
  expect(field(store, 'NRO-W-1891').holdReason).toBe('Power is Not Ready after the 8 May failed visit.');
  expect(switchUser(store, PERSON.priya).ok).toBe(true);
  expect(executeField(store, input).error.code).toBe('STALE_INTENT');
  expect(switchUser(store, PERSON.andre).ok).toBe(true);
  const shifted = {...field(store, CIVIC, 'dispatch'), commandId: 'changed-slot'};
  expect(store.commit({commandId: 'test-shift'}, board => ({writes: {program: {...board.program, crew: board.program.crew.map(item =>
    item.siteId === CIVIC ? {...item, rev: item.rev + 1, shiftAt: '2026-05-16T08:00:00'} : item)}}})).ok).toBe(true);
  expect(executeField(store, shifted).error.code).toBe('STALE_INTENT');
  expect(field(store, CIVIC).reasons.dispatch).toContain('No dispatch-specific approval');
  expect(store.getSnapshot().sites[CIVIC].executions).toEqual([]);
});

it.each([
  ['active hold', site => ({...site, holdActive: true}), 'The site is on hold.'],
  ['verified Not Ready', site => ({...site, rows: {...site.rows, Power: {...site.rows.Power, status: 'Not Ready'}}}), 'mandatory evidence'],
  ['stale mandatory row', site => ({...site, rows: {...site.rows, Power: {...site.rows.Power, sourceAt: '2026-05-02T09:40:00'}}}), 'mandatory evidence'],
  ['low confidence', site => ({...site, assessment: {...site.assessment, confidence: 59}}), 'Confidence is 59%'],
  ['changed plan revision', site => ({...site, planRev: 1}), 'current assessment'],
])('fails closed on %s even when a dispatch approval is on file', (_label, change, reason) => {
  const {store} = open(PERSON.andre);
  const input = {...field(store, CIVIC, 'dispatch'), commandId: 'old-confirmation'};
  expect(store.commit({commandId: 'change-site'}, board => ({writes: {sites: {...board.sites,
    [CIVIC]: {...change(board.sites[CIVIC]), rev: board.sites[CIVIC].rev + 1}}}})).ok).toBe(true);
  expect(field(store, CIVIC).reasons.dispatch).toContain(reason);
  expect(executeField(store, input).error.code).toBe('STALE_INTENT');
  const blockedBoard = store.getSnapshot();
  const live = field(store, CIVIC);
  expect(field(store, CIVIC, 'dispatch')).toBeNull();
  const fresh = {...siteFence(store, blockedBoard, blockedBoard.sites[CIVIC]), commandId: 'fresh-blocked-attempt',
    action: 'dispatch', assignmentId: live.assignment.id, assignmentRev: live.assignment.rev,
    approvalId: live.approvals.dispatch?.id ?? null, expectedFaultRev: blockedBoard.faults.rev};
  expect(executeField(store, fresh)).toMatchObject({ok: false, error: {code: 'FIELD_BLOCKED', message: expect.stringContaining(reason)}});
  expect(store.getSnapshot()).toEqual(blockedBoard);
  expect(siteAudit(store.getSnapshot(), CIVIC).filter(event => event.verb === 'Dispatched')).toEqual([]);
});

it('invalidates an unexecuted spare-slot approval when the assigned crew revision changes', () => {
  const {store} = open(PERSON.priya);
  expect(decide(store, review(store, HARBOR, 'spare-approval', 'approve', SPARE)).ok).toBe(true);
  expect(switchUser(store, PERSON.andre).ok).toBe(true);
  const confirmed = field(store, HARBOR, 'resequence');
  expect(confirmed).not.toBeNull();
  expect(store.commit({commandId: 'revise-harbor-crew'}, board => ({writes: {program: {...board.program,
    crew: board.program.crew.map(item => item.siteId === HARBOR ? {...item, rev: item.rev + 1} : item)}}})).ok).toBe(true);
  const before = store.getSnapshot();
  expect(field(store, HARBOR).reasons.resequence).toBe('Approval is required for the date move.');
  expect(field(store, HARBOR, 'resequence')).toBeNull();
  expect(executeField(store, {...confirmed, commandId: 'stale-spare-slot'}).error.code).toBe('STALE_INTENT');
  expect(store.getSnapshot()).toEqual(before);
});

it('records an authorized spare slot only after Priya approves and Andre confirms, without clearing the hold', () => {
  const {store} = open(PERSON.priya);
  const approval = decide(store, review(store, HARBOR, 'spare-approval', 'approve', SPARE));
  expect(approval.ok).toBe(true);
  expect(store.getSnapshot().sites[HARBOR].decisions[0]).toMatchObject({scope: {kind: 'resequence', assignmentId: 'crew_1842',
    crewLeadId: PERSON.luis, crewSize: 4, plannedDay: '2026-05-21', shiftAt: '2026-05-21T07:00:00'}, reviewedAssignmentRev: 0});
  expect(store.getSnapshot().program.crew.find(item => item.siteId === HARBOR).shiftAt).toBe('2026-05-18T07:00:00');
  expect(switchUser(store, PERSON.andre).ok).toBe(true);
  const input = {...field(store, HARBOR, 'resequence'), commandId: 'spare-execution'};
  expect(input.approvalId).toBe(approval.data.decisionId);
  const result = executeField(store, input);
  expect(result.ok).toBe(true);
  const board = store.getSnapshot();
  expect(board.sites[HARBOR]).toMatchObject({plan: {plannedDay: '2026-05-21'}, planRev: 1, holdActive: true, lifecycle: 'open'});
  expect(board.program.crew.find(item => item.siteId === HARBOR)).toMatchObject({shiftAt: '2026-05-21T07:00:00', state: 'Hold'});
  expect(board.sites[HARBOR].executions).toEqual([expect.objectContaining({id: result.data.executionId, action: 'resequence',
    actorId: PERSON.andre, assignmentId: 'crew_1842', approvalId: approval.data.decisionId, planRev: 1, evidenceRev: 0, snapshotId: 'snap_1842_0934'})]);
  expect(siteAudit(board, HARBOR)[0]).toMatchObject({id: result.data.eventId, verb: 'Disposition', actorId: PERSON.andre,
    executionId: result.data.executionId, decisionId: approval.data.decisionId, snapshotId: 'snap_1842_0934', executionEvidenceRev: 0});
  expect(field(store, HARBOR, 'resequence')).toBeNull();
  expect(field(store, HARBOR, 'dispatch')).toBeNull();
});

it('records an eligible confirmed crew hold without altering the shift, plan or failed visits', () => {
  const fixture = open(PERSON.andre);
  const {store} = fixture;
  const before = store.getSnapshot();
  const input = {...field(store, CIVIC, 'hold'), commandId: 'field-hold'};
  expect(input.approvalId).toBeNull();
  const missing = {...input};
  delete missing.approvalId;
  expectNoWrites(fixture, () => executeField(store, missing), 'BAD_INPUT', REVIEW_AGAIN);
  const result = executeField(store, input);
  expect(result.ok).toBe(true);
  const board = store.getSnapshot();
  expect(board.sites[CIVIC]).toMatchObject({plan: before.sites[CIVIC].plan, holdActive: true, disposition: 'Hold'});
  expect(board.program.crew.find(item => item.siteId === CIVIC)).toEqual({...before.program.crew.find(item => item.siteId === CIVIC), rev: 1, state: 'Hold'});
  expect(board.program.failures).toEqual(before.program.failures);
  expect(field(store, CIVIC, 'dispatch')).toBeNull();
  expect(field(store, CIVIC, 'hold')).toBeNull();
  expect(board.sites[CIVIC].executions).toEqual([expect.objectContaining({id: result.data.executionId, action: 'hold',
    actorId: PERSON.andre, assignmentId: 'crew_1847', approvalId: null, planRev: 0, evidenceRev: 0, snapshotId: before.sites[CIVIC].assessment.snapshotId})]);
  expect(siteAudit(board, CIVIC)[0]).toMatchObject({id: result.data.eventId, verb: 'Disposition', actorId: PERSON.andre,
    executionId: result.data.executionId, decisionId: null, snapshotId: before.sites[CIVIC].assessment.snapshotId, executionEvidenceRev: 0});
});
