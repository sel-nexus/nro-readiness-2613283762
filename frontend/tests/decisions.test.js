/** Exercise decision boundaries through the real journaled workshop store. */
import {webcrypto} from 'node:crypto';
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

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

/** Seed an isolated workshop and optionally fail one transactional write. */
function open(actor) {
  let failKey;
  const records = new Map();
  const store = createStore({getItem: key => records.get(key) ?? null, removeItem: key => records.delete(key),
    setItem: (key, value) => {
      if (key === failKey) { failKey = null; throw new Error('Quota simulated'); }
      records.set(key, value);
    }});
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, actor).ok).toBe(true);
  return {store, failOn: key => { failKey = `nro.demo.${key}`; }};
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
  expect(decide(store, {...input, rationale: '  short  '}).error.code).toBe('BAD_RATIONALE');
  expect(decide(store, {...input, verb: 'modify', ownerId: 'random', dueDay: '2026-05-32', note: ' '}).error.code).toBe('BAD_MODIFICATION');
  expect(decide(store, {...input, reviewKey: 'different'}).error.code).toBe('STALE_INTENT');
  expect(decide(store, review(store, PORT, 'wrong-site', 'approve', SPARE)).error.code).toBe('STALE_INTENT');
  expect(store.getSnapshot()).toEqual(before);
});

it('requires explicit confidence review for a low-confidence schedule change without turning it into dispatch approval', () => {
  const {store} = open(PERSON.priya);
  expect(store.commit({commandId: 'lower-confidence'}, board => ({writes: {sites: {...board.sites,
    [PORT]: {...board.sites[PORT], rev: 1, assessment: {...board.sites[PORT].assessment, confidence: 59}}}}})).ok).toBe(true);
  const before = store.getSnapshot();
  const input = review(store, PORT, 'low-confidence-approval', 'approve');
  expect(decide(store, input).error.code).toBe('REVIEW_REQUIRED');
  expect(store.getSnapshot()).toBe(before);
  expect(decide(store, {...input, confidenceReviewed: true}).ok).toBe(true);
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
  expect(siteAudit(store.getSnapshot(), CIVIC).filter(event => event.verb === 'Dispatched')).toEqual([]);
});

it('records an authorized spare slot only after Priya approves and Andre confirms, without clearing the hold', () => {
  const {store} = open(PERSON.priya);
  expect(decide(store, review(store, HARBOR, 'spare-approval', 'approve', SPARE)).ok).toBe(true);
  expect(store.getSnapshot().program.crew.find(item => item.siteId === HARBOR).shiftAt).toBe('2026-05-18T07:00:00');
  expect(switchUser(store, PERSON.andre).ok).toBe(true);
  const input = {...field(store, HARBOR, 'resequence'), commandId: 'spare-execution'};
  expect(executeField(store, input).ok).toBe(true);
  const board = store.getSnapshot();
  expect(board.sites[HARBOR]).toMatchObject({plan: {plannedDay: '2026-05-21'}, planRev: 1, holdActive: true, lifecycle: 'open'});
  expect(board.program.crew.find(item => item.siteId === HARBOR)).toMatchObject({shiftAt: '2026-05-21T07:00:00', state: 'Hold'});
  expect(field(store, HARBOR, 'resequence')).toBeNull();
});

it('records an eligible confirmed crew hold without altering the shift, plan or failed visits', () => {
  const {store} = open(PERSON.andre);
  const before = store.getSnapshot();
  const input = {...field(store, CIVIC, 'hold'), commandId: 'field-hold'};
  expect(executeField(store, input).ok).toBe(true);
  const board = store.getSnapshot();
  expect(board.sites[CIVIC]).toMatchObject({plan: before.sites[CIVIC].plan, holdActive: true, disposition: 'Hold'});
  expect(board.program.crew.find(item => item.siteId === CIVIC)).toEqual({...before.program.crew.find(item => item.siteId === CIVIC), rev: 1, state: 'Hold'});
  expect(board.program.failures).toEqual(before.program.failures);
  expect(field(store, CIVIC, 'dispatch')).toBeNull();
  expect(field(store, CIVIC, 'hold')).toBeNull();
});
