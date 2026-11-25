/** Reconcile the released register with the original activity and immutable score history. */
import {DIRECTORY, freezeTree, PERSON, USERS} from './people.js';
import {ACTIVITIES, NOTES, PROGRAM, UPLOADS} from './program.js';
import {civil, MODEL, MORNING_SCORE_AT, REGISTER, ROW_ORDER, SUPPLIERS} from './register.js';

export const BOARD_KEYS = Object.freeze(['scenario', 'sites', 'program', 'audit', 'uploads', 'faults']);
const CIVIC = 'NRO-W-1847';
const CIVIC_APPROVAL = 'approval_1847_0511';
const CIVIC_LEGACY = 'snap_1847_0511';
const CIVIC_RATIONALE = 'Evidence is current and no prerequisite is open.';

/** Capture scored inputs by value, not by reference to mutable working evidence. */
export function captureSnapshot(site, id) {
  return {
    id, siteId: site.id, plan: {...site.plan}, planRev: site.planRev, evidenceRev: site.evidenceRev,
    rows: ROW_ORDER.map(row => {
      const {status, quality, source, sourceAt, ingestedAt, observations} = site.rows[row];
      return {row, status, quality, source, sourceAt, ingestedAt, observations: structuredClone(observations)};
    }),
  };
}

/** Build all linked seed records; save generated scores to audit, never to the feed. */
function assemble() {
  const sites = structuredClone(REGISTER);
  const snapshots = {};
  const closeScores = {
    'NRO-W-1810': ['05-04 15:00', 96], 'NRO-W-1816': ['05-06 13:00', 95],
  };
  for (const site of Object.values(sites)) {
    const close = closeScores[site.id];
    if (close) {
      site.assessment.scoredAt = civil(close[0]);
      site.assessment.snapshotId = `snap_${site.id.slice(-4)}_close`;
    }
    const id = site.assessment.snapshotId;
    snapshots[id] = captureSnapshot(site, id);
  }
  snapshots[CIVIC_LEGACY] = captureSnapshot(sites[CIVIC], CIVIC_LEGACY);
  const plan = sites[CIVIC].plan;
  const {id: assignmentId, leadId: crewLeadId, size: crewSize, shiftAt} = PROGRAM.crew.find(row => row.siteId === CIVIC);
  sites[CIVIC].decisions.push({id: CIVIC_APPROVAL, proposalId: 'rec_1847', verb: 'approve', actorId: PERSON.priya,
    at: civil('05-11 15:45'), rationale: CIVIC_RATIONALE, scope: {kind: 'dispatch', assignmentId, crewLeadId, crewSize, shiftAt},
    before: {...plan}, after: {...plan}, effectivePlanRev: 0, assessmentRef: CIVIC_LEGACY,
    workflowId: null, ownerId: null, dueDay: null, note: null});
  for (const {siteId, note} of NOTES) sites[siteId].notes.push(structuredClone(note));

  const events = ACTIVITIES.map(({id, actorLabel, ...feed}) => {
    const event = {id: id.replace('feed_', 'ev_'), ...feed};
    const assessment = sites[event.siteId]?.assessment;
    if (event.verb === 'Scored') {
      Object.assign(event, {model: MODEL, correlationId: assessment.correlationId,
        snapshotId: event.siteId === CIVIC ? CIVIC_LEGACY : assessment.snapshotId,
        output: closeScores[event.siteId]?.[1] ?? assessment.probability, confidence: assessment.confidence});
    }
    if (event.siteId === CIVIC && event.verb === 'Approval') Object.assign(event, {
      decisionId: CIVIC_APPROVAL, rationale: CIVIC_RATIONALE, model: MODEL, correlationId: assessment.correlationId,
      snapshotId: CIVIC_LEGACY, output: 92, confidence: 90,
    });
    if (event.siteId === 'NRO-W-1891' && event.verb === 'Disposition') {
      event.rationale = 'Keep Northwind on the rework. A supplier change is not justified yet.';
    }
    return event;
  });
  for (const site of Object.values(sites)) {
    if (site.lifecycle === 'on_air' || site.id === 'NRO-W-1842') continue;
    const {probability: output, confidence, correlationId, snapshotId} = site.assessment;
    events.push({id: `ev_score_${site.id.slice(-4)}_0934`, seq: events.length + 1, at: MORNING_SCORE_AT,
      siteId: site.id, actorKind: 'model', actorId: 'model', verb: 'Scored', model: MODEL, correlationId,
      snapshotId, output, confidence, detail: `${output === null ? 'Unavailable' : `${output}%`} / confidence ${confidence}% / ${correlationId}`});
  }
  return {users: USERS, session: null, scenario: 'A', sites, program: PROGRAM, uploads: UPLOADS,
    audit: {nextSeq: events.length + 1, replaySeq: 0, generation: 0, events, snapshots, receipts: {}},
    faults: {rev: 0, assessmentDown: false, retryFailuresRemaining: 0, ddlOverride: null,
      scenarioAssessmentDown: false, scenarioDdlDown: false, forceLowConfidence: false}};
}

/** Recognize a non-array record from a JSON envelope. */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Check for an own record key, not an inherited property. */
const owns = (obj, key) => Object.hasOwn(obj, key);
/** Recognize persisted nonnegative revision counters. */
export const counter = value => Number.isSafeInteger(value) && value >= 0;
/** Fail with one redacted validation error rather than exposing stored record content. */
function requireValid(test) {
  if (!test) throw new Error('Invalid readiness board records.');
}

/** Check account and optional session envelopes independently of board recovery. */
export function validateAccess(users, session) {
  requireValid(record(users) && Object.keys(users).length === Object.keys(USERS).length);
  for (const [id, user] of Object.entries(USERS)) {
    requireValid(record(users[id]) && Object.keys(users[id]).length === Object.keys(user).length
      && Object.keys(user).every(key => user[key] === users[id][key]));
  }
  requireValid(session === null || (record(session) && Object.keys(session).length === 4 && owns(users, session.userId)
    && users[session.userId].role === session.role && typeof session.token === 'string' && session.token.length > 0
    && typeof session.signedInAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(session.signedInAt)));
}

/** Validate the board's shapes and cross-record references before publishing or writing. */
export function validateBoard({users, session, scenario, sites, program, uploads, audit, faults}) {
  validateAccess(users, session);
  requireValid(['A', 'B', 'C', 'D'].includes(scenario) && record(sites) && record(program)
    && record(uploads) && record(audit) && record(faults));
  const {events, snapshots, receipts, generation, nextSeq, replaySeq} = audit;
  requireValid(Array.isArray(events) && record(snapshots) && record(receipts) && counter(generation) && counter(nextSeq) && counter(replaySeq));
  requireValid(counter(faults.rev) && counter(faults.retryFailuresRemaining) && [null, 'Up', 'Down'].includes(faults.ddlOverride)
    && ['assessmentDown', 'scenarioAssessmentDown', 'scenarioDdlDown', 'forceLowConfidence'].every(key => typeof faults[key] === 'boolean'));
  requireValid(['crew', 'failures', 'design', 'notices', 'morning', 'trend', 'visitsAtStake'].every(key => Array.isArray(program[key]))
    && record(program.eco) && record(program.sources) && record(program.lastScore));
  requireValid(Object.keys(sites).length === Object.keys(REGISTER).length && Object.keys(REGISTER).every(id => owns(sites, id)));
  const historical = new Set(['NRO-W-1766', 'NRO-W-1794']);
  const hasSite = id => owns(sites, id);
  const hasActor = id => owns(users, id) || owns(DIRECTORY, id);
  const hasSnapshot = (id, siteId) => record(snapshots[id]) && snapshots[id].siteId === siteId;
  const validPlan = plan => record(plan) && owns(SUPPLIERS, plan.supplierId) && SUPPLIERS[plan.supplierId].agreementId === plan.agreementId;
  const validRow = row => record(row) && ROW_ORDER.includes(row.row)
    && ['Ready', 'Not Ready', 'In progress', 'Unavailable'].includes(row.status)
    && ['Current', 'Stale', 'Conflicting', 'Missing'].includes(row.quality)
    && typeof row.source === 'string' && Array.isArray(row.observations)
    && (row.quality !== 'Missing' || (row.status === 'Unavailable' && row.sourceAt === null))
    && (row.quality !== 'Conflicting' || row.observations.length >= 2);
  const crew = Object.fromEntries(program.crew.map(item => [item.id, item]));
  requireValid(Object.keys(crew).length === program.crew.length);
  for (const item of program.crew) requireValid(counter(item.rev) && (item.siteId === null || hasSite(item.siteId))
    && (item.leadId === null || hasActor(item.leadId)) && (item.size === null || counter(item.size)));
  const decisions = new Map();
  for (const [id, site] of Object.entries(sites)) {
    requireValid(site.id === id && validPlan(site.plan) && [site.rev, site.evidenceRev, site.planRev].every(counter)
      && [site.x, site.y].every(value => counter(value) && value <= 100) && typeof site.holdActive === 'boolean'
      && ['open', 'dispatched', 'on_air'].includes(site.lifecycle) && (site.ownerId === null || hasActor(site.ownerId))
      && record(site.rows) && Object.keys(site.rows).join() === ROW_ORDER.join()
      && ROW_ORDER.every(row => validRow(site.rows[row]) && site.rows[row].row === row && hasActor(site.rows[row].ownerId))
      && [site.notes, site.decisions, site.executions].every(Array.isArray));
    requireValid(site.assessment === null || (site.assessment.siteId === id && hasSnapshot(site.assessment.snapshotId, id)
      && counter(site.assessment.confidence) && site.assessment.confidence <= 100
      && (site.assessment.probability === null || (counter(site.assessment.probability) && site.assessment.probability <= 100))));
    for (const note of site.notes) requireValid(hasActor(note.actorId));
    if (site.proposal) requireValid(site.proposal.ownerId === null || hasActor(site.proposal.ownerId));
    for (const item of site.decisions) {
      requireValid(!decisions.has(item.id) && hasActor(item.actorId) && validPlan(item.before) && validPlan(item.after)
        && (item.assessmentRef == null || hasSnapshot(item.assessmentRef, id)));
      decisions.set(item.id, id);
    }
    for (const item of site.executions) requireValid(hasActor(item.actorId) && crew[item.assignmentId]?.siteId === id
      && (item.approvalId == null || decisions.get(item.approvalId) === id)
      && (item.snapshotId == null || hasSnapshot(item.snapshotId, id)));
  }
  for (const [id, snap] of Object.entries(snapshots)) requireValid(snap.id === id && hasSite(snap.siteId) && validPlan(snap.plan)
    && counter(snap.planRev) && counter(snap.evidenceRev) && Array.isArray(snap.rows)
    && snap.rows.map(row => row.row).join() === ROW_ORDER.join() && snap.rows.every(validRow));
  const eventIds = new Set();
  let lastSeq = 0;
  for (const event of events) {
    requireValid(typeof event.id === 'string' && !eventIds.has(event.id) && counter(event.seq) && event.seq > lastSeq
      && (event.siteId == null || hasSite(event.siteId) || historical.has(event.siteId))
      && (event.snapshotId == null || hasSnapshot(event.snapshotId, event.siteId))
      && (event.decisionId == null || decisions.get(event.decisionId) === event.siteId)
      && (event.workflowId == null || program.eco[event.workflowId]?.siteId === event.siteId));
    eventIds.add(event.id);
    lastSeq = event.seq;
  }
  requireValid(nextSeq > lastSeq);
  for (const item of Object.values(receipts)) requireValid(record(item) && owns(users, item.actorId)
    && typeof item.intentKey === 'string' && record(item.safeResult) && typeof item.safeResult.ok === 'boolean');
  for (const [id, doc] of Object.entries(uploads)) requireValid(doc.id === id && hasSite(doc.siteId)
    && owns(sites[doc.siteId].rows, doc.row) && counter(doc.sizeBytes) && hasActor(doc.addedBy));
  for (const [id, item] of Object.entries(program.eco)) requireValid(item.id === id && decisions.get(item.decisionId) === item.siteId);
  requireValid(program.notices.every(item => item.siteId === null || hasSite(item.siteId)) && program.visitsAtStake.every(hasSite)
    && [...program.failures, ...program.morning].every(item => hasSite(item.siteId) || historical.has(item.siteId))
    && hasSnapshot(program.lastScore.snapshotId, program.lastScore.siteId));
}

const SEED = freezeTree(assemble());
validateBoard(SEED);
const seedSites = Object.values(SEED.sites);
const scores = SEED.audit.events.filter(event => event.verb === 'Scored');
requireValid(SEED.program.morning.length === 37 && Object.keys(SEED.audit.snapshots).length === 17
  && scores.filter(event => event.at === MORNING_SCORE_AT).length === 14
  && scores.length === 17 && SEED.audit.events.length === 50
  && seedSites.reduce((n, site) => n + site.notes.length, 0) === 11 && Object.keys(SEED.uploads).length === 5
  && SEED.program.notices.length === 12 && SEED.program.notices.filter(notice => notice.unread).length === 8
  && SEED.program.crew.length === 10 && SEED.program.design.length === 6 && SEED.program.failures.length === 3
  && SEED.program.trend.length === 14 && Object.keys(SEED.program.sources).length === 7);

/** Return an independent working copy; callers cannot mutate the canonical seed. */
export function makeBaseline() {
  return structuredClone(SEED);
}
