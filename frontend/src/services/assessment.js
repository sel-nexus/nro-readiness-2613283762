/** Replay only released model inputs and discard delayed work after context changes. */
import {captureSnapshot} from '../data/baseline.js';
import {DEFAULT_PROGRAM, makeProgramBoard, PROGRAMS} from '../data/programs.js';
import {BOARD_AT, REGISTER, ROW_ORDER} from '../data/register.js';
import {authorize, INTENT, readAccess} from '../utils/access.js';
import {assessmentIsDown, civilMillis, deriveReadiness, inHorizon, rowQuality} from '../utils/readiness.js';
import {appendEvent, commandError, siteFence} from './evidence.js';

export const SCORING_DELAY = 700;
export const UNSUPPORTED_REPLAY = 'No supported assessment matches these inputs. The last score is historical.';
const STALE = 'Board or access changed. Review and confirm again.';
const pending = new WeakMap();

/** Normalize source labels without conflating different evidence timestamps or statuses. */
const normalizeSource = source => source.trim().replace(/\s+/g, ' ').toLowerCase();

/** Serialize immutable, model-relevant inputs in fixed order; omit notes and documents. */
export function assessmentSignature(site) {
  const {supplierId, agreementId, plannedDay, closedAt} = site.plan;
  return JSON.stringify([site.id, supplierId, agreementId, plannedDay, closedAt, ROW_ORDER.map(key => {
    const row = site.rows[key];
    const quality = rowQuality(row);
    return [key, row.status, quality, normalizeSource(row.source), row.sourceAt,
      quality === 'Conflicting' ? row.observations.map(item => JSON.stringify([normalizeSource(item.source), item.status, item.sourceAt])).sort() : []];
  })]);
}

const releasedSites = [
  ...Object.values(REGISTER),
  ...Object.keys(PROGRAMS).filter(id => id !== DEFAULT_PROGRAM).flatMap(id => Object.values(makeProgramBoard(id).sites)),
];
const fixtures = new Map(releasedSites.filter(site => site.lifecycle === 'open')
  .map(site => [assessmentSignature(site), site.assessment]));

/** Advance time by one deterministic second per successful board replay. */
const scoreTime = seq => new Date(civilMillis(BOARD_AT) + (seq - 1) * 1000).toISOString().slice(0, 19);

/** Release the scoring slot promptly when the initiating pane is canceled. */
function waitForReplay(signal) {
  return new Promise(resolve => {
    const timer = setTimeout(finish, SCORING_DELAY);
    signal?.addEventListener('abort', finish, {once: true});

    /** Settle once and release the timer and abort listener. */
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
  });
}

/** Return a retained result without creating a new score or snapshot. */
function retained(site, state) {
  const {assessment} = site;
  return {state, scoredAt: assessment?.scoredAt ?? null, correlationId: assessment?.correlationId ?? null};
}

/** Build an actual replay outcome against the committed board under the storage guard. */
function replay(board, actor, site, input, signature) {
  const {faults} = board;
  const mode = input.mode;
  const applicable = site.lifecycle === 'open' && inHorizon(site.plan.plannedDay);
  let nextFaults = faults;
  let state;
  let detail;
  if (!applicable) {
    state = 'inapplicable';
    detail = 'No new forecast applies to this site.';
  } else if (assessmentIsDown(faults)) {
    if (mode === 'retry') {
      nextFaults = faults.retryFailuresRemaining > 0
        ? {...faults, rev: faults.rev + 1, retryFailuresRemaining: faults.retryFailuresRemaining - 1}
        : {...faults, rev: faults.rev + 1, assessmentDown: false, scenarioAssessmentDown: false, retryFailuresRemaining: 0};
    }
    if (assessmentIsDown(nextFaults)) {
      state = 'retained_outage';
      detail = 'Assessment service unavailable';
    }
  }
  const fixture = !state && fixtures.get(signature);
  if (!state && !fixture) {
    state = 'unsupported';
    detail = UNSUPPORTED_REPLAY;
  }
  const writes = nextFaults === faults ? {} : {faults: nextFaults};
  const event = {id: `ev_${input.commandId}`, siteId: site.id};
  if (state) {
    const next = site.lifecycle === 'open' ? {...site, rev: site.rev + 1, scoreState: state} : site;
    if (next !== site) {
      next.risk = deriveReadiness(next, BOARD_AT, nextFaults, board.audit.snapshots[next.assessment?.snapshotId]).risk;
      writes.sites = {...board.sites, [site.id]: next};
    }
    writes.audit = appendEvent(board.audit, {...event, at: BOARD_AT, actorKind: 'person', actorId: actor.id,
      verb: state === 'retained_outage' ? 'Assessment failed' : 'Assessment not scored', outcome: state, detail});
    return {writes, result: {...retained(site, state), retryAvailable: state === 'retained_outage'}};
  }

  const seq = board.audit.replaySeq + 1;
  const suffix = `${site.id.slice(-4)}_r${seq}`;
  const snapshotId = `snap_${suffix}`;
  const correlationId = `corr_${suffix}`;
  const scoredAt = scoreTime(seq);
  const {model, probability, confidence} = fixture;
  const assessment = {...fixture, scoredAt, correlationId, snapshotId, planRev: site.planRev, evidenceRev: site.evidenceRev};
  const snapshot = captureSnapshot(site, snapshotId);
  for (const row of snapshot.rows) row.quality = rowQuality(row);
  state = probability === null ? 'unavailable' : 'current';
  const next = {...site, assessment, scoreState: state, rev: site.rev + 1};
  next.risk = deriveReadiness(next, BOARD_AT, nextFaults, snapshot).risk;
  writes.sites = {...board.sites, [site.id]: next};
  writes.audit = appendEvent({...board.audit, replaySeq: seq, snapshots: {...board.audit.snapshots, [snapshotId]: snapshot}},
    {...event, at: scoredAt, actorKind: 'model', actorId: 'model', verb: 'Scored', model, correlationId, snapshotId,
      output: probability, confidence, detail: `${probability === null ? 'Unavailable' : `${probability}%`} / confidence ${confidence}% / ${correlationId}`});
  writes.program = {...board.program, lastScore: {siteId: site.id, model, scoredAt, correlationId, snapshotId}};
  return {writes, result: {state, model, probability, confidence, scoredAt, correlationId, snapshotId}};
}

/** Run or retry a local assessment after the scoring delay.
 *
 * Args:
 *   store: Committed workshop storage adapter.
 *   input: Command ID, site ID, expected site revision, mode and navigation signal.
 * Returns:
 *   A promise for the committed outcome or a failure; stale callbacks never write.
 */
export async function runAssessment(store, input = {}) {
  const {siteId, commandId, expectedSiteRev, mode = 'run', signal} = input;
  if (typeof commandId !== 'string' || !commandId.trim() || typeof siteId !== 'string' ||
    !Number.isSafeInteger(expectedSiteRev) || expectedSiteRev < 0 || !['run', 'retry'].includes(mode)) {
    return commandError('BAD_INPUT', 'Invalid assessment command.');
  }
  const board = store.getSnapshot();
  const intent = mode === 'retry' ? INTENT.retry : INTENT.assess;
  if (!authorize(readAccess(board), intent)) return commandError('FORBIDDEN', 'This action is not permitted.');
  if (!Object.hasOwn(board.sites, siteId)) return commandError('NOT_FOUND', 'Site not found.');
  const site = board.sites[siteId];
  const fence = siteFence(store, board, site);
  const intentKey = `${intent}:${siteId}:${expectedSiteRev}`;
  const existing = Object.hasOwn(board.audit.receipts, commandId);
  if (signal?.aborted || Object.entries(fence).some(([field, value]) =>
    input[field] !== undefined && input[field] !== value && !(existing && field === 'expectedSiteRev'))) {
    return commandError('STALE_INTENT', STALE);
  }
  const signature = assessmentSignature(site);
  const plans = site.planRev;
  const evidence = site.evidenceRev;
  const faultRev = board.faults.rev;
  const active = pending.get(store) ?? new Set();
  const key = `${fence.expectedGeneration}:${fence.expectedSessionEpoch}:${siteId}`;
  if (!existing) {
    if (active.has(key)) return commandError('SCORING', 'An assessment is already running for this site.');
    pending.set(store, active);
    active.add(key);
  }
  try {
    if (!existing) await waitForReplay(signal);
    if (signal?.aborted) return commandError('STALE_INTENT', STALE);
    return store.commit({...fence, expectedSiteRev, commandId, intentKey, authorize: (live, actor) => {
      if (!authorize(actor, intent)) return false;
      const candidate = live.sites[siteId];
      if (signal?.aborted) return commandError('STALE_INTENT', STALE);
      if (existing) return Object.hasOwn(live.audit.receipts, commandId) || commandError('STALE_INTENT', STALE);
      return (candidate?.rev === expectedSiteRev && candidate.planRev === plans && candidate.evidenceRev === evidence &&
        live.faults.rev === faultRev && assessmentSignature(candidate) === signature) || commandError('STALE_INTENT', STALE);
    }}, (live, actor) => replay(live, actor, live.sites[siteId], {commandId, mode}, signature));
  } catch {
    return commandError('ASSESSMENT_ERROR', 'Could not complete the assessment. No score was confirmed.');
  } finally {
    if (!existing) active.delete(key);
  }
}

/** Read the retained score reference for dismissal without committing anything. */
export function keepLastScore(store, {siteId} = {}) {
  const board = store.getSnapshot();
  if (!authorize(readAccess(board), INTENT.read)) return commandError('FORBIDDEN', 'Sign in to view the score.');
  if (!Object.hasOwn(board.sites, siteId)) return commandError('NOT_FOUND', 'Site not found.');
  return {ok: true, data: retained(board.sites[siteId], 'retained_outage')};
}
