/** Project and commit local interventions without conflating approval and execution. */
import {DIRECTORY, PERSON, USERS} from '../data/people.js';
import {BOARD_AT, ROW_ORDER, SUPPLIERS} from '../data/register.js';
import {authorize, INTENT, readAccess} from '../utils/access.js';
import {civilMillis, deriveReadiness, MANDATORY, REVIEW_BELOW} from '../utils/readiness.js';
import {appendEvent, commandError, siteFence} from './evidence.js';

const DECISIONS = ['approve', 'reject', 'modify', 'override'];
const FIELD = {dispatch: INTENT.dispatch, hold: INTENT.fieldHold, resequence: INTENT.resequence};
const STALE = 'Board or access changed. Review and confirm again.';

/** Derive live evidence gates independently of the historical intervention. */
const readinessFor = (board, site) => deriveReadiness(site, BOARD_AT, board.faults, board.audit.snapshots[site.assessment?.snapshotId]);

/** Rank live prerequisites by blocker status, urgency, and stable row order. */
export function rank(site, readiness) {
  if (site.lifecycle !== 'open') return [];
  const proposal = site.proposal;
  return ROW_ORDER.flatMap((row, order) => {
    const {status, ownerId} = site.rows[row];
    const quality = readiness.quality[row];
    const critical = MANDATORY.includes(row) || (row === 'Workforce' && site.crewRequired);
    const indicated = proposal?.targetRow === row;
    let kind;
    if ((quality !== 'Current' || status === 'Unavailable') && (critical || indicated)) kind = 'repair';
    else if (status === 'Not Ready' && critical) kind = 'blocker';
    else if (status === 'In progress') kind = critical ? 'pending' : 'watch';
    else if (status === 'Not Ready' && indicated) kind = 'watch';
    if (!kind) return [];
    return [{row, order, status, quality, kind, ownerId, impact: MANDATORY.includes(row) ? 2 : critical ? 1 : 0,
      dueDay: (indicated ? proposal.dueDay : null) ?? site.plan.plannedDay,
      dueTime: indicated ? proposal.dueTime : null, window: indicated ? proposal.window : null}];
  }).sort((a, b) => Number(b.kind === 'blocker') - Number(a.kind === 'blocker')
    || (a.kind === 'blocker' && b.kind === 'blocker' ? b.impact - a.impact : 0)
    || `${a.dueDay ?? '9999'} ${a.dueTime ?? '23:59'}`.localeCompare(`${b.dueDay ?? '9999'} ${b.dueTime ?? '23:59'}`)
    || a.order - b.order);
}

/** Explain the role restriction without retaining any attempted rationale. */
export const approvalDenialReason = actor => `Only the program manager can approve a supplier or schedule change. You are signed in as ${actor.title}.`;

/** Identify a review fence without accepting client-supplied write keys. */
function command(input, key, authorizeCommand) {
  const {commandId, siteId, expectedSiteRev, expectedGeneration, expectedSessionEpoch, expectedSessionToken} = input;
  return {commandId, siteId, expectedSiteRev, expectedGeneration, expectedSessionEpoch, expectedSessionToken,
    intentKey: JSON.stringify([key, siteId, expectedSiteRev, input.proposalId ?? null, input.optionId ?? null, input.row ?? null,
      input.expectedFaultRev ?? null, input.reviewedAssignmentRev ?? null]), authorize: authorizeCommand};
}

/** Require a captured site, generation and access context for a write. */
function fenced(input) {
  return typeof input.siteId === 'string' && typeof input.expectedSessionToken === 'string'
    && [input.expectedGeneration, input.expectedSessionEpoch, input.expectedSiteRev].every(value => Number.isSafeInteger(value) && value >= 0);
}

/** Retain only the historical model fields needed to explain an event. */
function assessed(site) {
  const score = site.assessment;
  return {model: score?.model ?? null, correlationId: score?.correlationId ?? null, snapshotId: score?.snapshotId ?? null,
    output: score?.probability ?? null, confidence: score?.confidence ?? null};
}

/** Append a timestamped site event with a stable sequence-derived identity. */
function eventFor(audit, site, actor, verb, detail, context = {}) {
  const id = `ev_decision_${audit.nextSeq}`;
  return {id, audit: appendEvent(audit, {id, at: BOARD_AT, siteId: site.id, actorKind: 'person', actorId: actor.id, verb, detail, ...context})};
}

/** Explain each strictly non-consequential Operator follow-up. */
export function operatorActions(board, site, actor) {
  const proposal = site.proposal;
  const active = site.lifecycle === 'open' && proposal?.planRev === site.planRev
    && ['Recommended', 'Pending approval', 'Modified'].includes(proposal.state);
  const candidates = rank(site, readinessFor(board, site));
  const next = candidates[0];
  const row = candidates.find(item => item.row === proposal?.targetRow && item.kind !== 'watch')?.row ?? null;
  const gate = !authorize(actor, INTENT.assign) ? 'Only Operators can record follow-up.'
    : !active ? 'There is no current recommendation to act on.'
      : next?.kind === 'blocker' && next.row !== proposal.targetRow ? 'The saved recommendation does not cover this blocker.' : null;
  const consequential = proposal?.payload != null && (proposal.payload.kind !== 'hold' || Object.keys(proposal.payload).length !== 1);
  const assigned = site.followUp?.assignment?.proposalId === proposal?.id && site.followUp?.assignment?.ownerId === proposal?.ownerId;
  const refreshed = row !== null && site.followUp?.refresh?.row === row && site.followUp.refresh.proposalId === proposal.id
    && site.followUp.refresh.evidenceRev === site.evidenceRev;
  return {row, assign: gate ?? (!proposal?.ownerId ? 'No owner is indicated.' : assigned ? 'Owner already assigned.' : null),
    refresh: gate ?? (!row ? 'No evidence refresh is indicated.' : refreshed ? 'Refresh already requested.' : null),
    precautionaryHold: gate ?? (site.holdActive ? 'Hold is already in effect.' : consequential ? 'Review this change in Approval.'
      : !row ? 'No eligible precautionary hold is indicated.' : null)};
}

/** Commit one Operator follow-up; first recording and action share a transaction. */
function followUp(store, input, intent) {
  if (!fenced(input)) return commandError('BAD_INPUT', STALE);
  return store.commit(command(input, intent, (_board, actor) => authorize(actor, intent)), (board, actor) => {
    const site = board.sites[input.siteId];
    const proposal = site.proposal;
    const gates = operatorActions(board, site, actor);
    if (!proposal || proposal.id !== input.proposalId) return commandError('STALE_INTENT', STALE);
    if (gates[intent]) return commandError('INAPPLICABLE', gates[intent]);
    if (intent === INTENT.refresh && input.row !== gates.row) return commandError('STALE_INTENT', STALE);
    let audit = board.audit;
    if (!audit.events.some(event => event.siteId === site.id && event.verb === 'Recommended'
      && (event.proposalId === proposal.id || (event.proposalId == null && site.id === 'NRO-W-1842')))) {
      audit = eventFor(audit, site, actor, 'Recommended', proposal.impact, {...assessed(site), proposalId: proposal.id}).audit;
    }
    const next = {...site, rev: site.rev + 1, followUp: {...site.followUp}};
    let verb, message, detail, ownerId;
    if (intent === INTENT.assign) {
      ownerId = proposal.ownerId;
      next.ownerId = ownerId;
      next.followUp.assignment = {proposalId: proposal.id, ownerId};
      verb = 'Owner assigned';
      message = `${(board.users[ownerId] ?? DIRECTORY[ownerId]).name} assigned for follow-up.`;
    } else if (intent === INTENT.refresh) {
      ownerId = site.rows[gates.row].ownerId;
      next.followUp.refresh = {proposalId: proposal.id, row: gates.row, ownerId, evidenceRev: site.evidenceRev};
      verb = 'Evidence refresh requested';
      message = `Refresh requested for ${gates.row} from ${(board.users[ownerId] ?? DIRECTORY[ownerId]).name}. Recorded locally.`;
    } else {
      next.holdActive = true;
      next.disposition = 'Hold';
      next.holdReason = `${gates.row} requires follow-up before work proceeds.`;
      verb = 'Precautionary hold';
      message = 'Precautionary hold applied.';
      detail = next.holdReason;
    }
    const event = eventFor(audit, site, actor, verb, detail ?? message, {...assessed(site), proposalId: proposal.id});
    return {writes: {sites: {...board.sites, [site.id]: next}, audit: event.audit},
      result: {eventId: event.id, message, ownerId: ownerId ?? null, disposition: next.disposition}};
  });
}

/** Assign only the current proposal's indicated owner. */
export const assignOwner = (store, input = {}) => followUp(store, input, INTENT.assign);
/** Set an eligible planning hold without executing crew work. */
export const precautionaryHold = (store, input = {}) => followUp(store, input, INTENT.precautionaryHold);
/** Record a local request without changing evidence or sending a message. */
export const requestRefresh = (store, input = {}) => followUp(store, input, INTENT.refresh);

/** Resolve an exact reviewed proposal/option into an allowlisted before/after plan. */
export function previewApproval(site, optionId = null) {
  const proposal = site.proposal;
  const option = optionId == null ? null : proposal?.alternatives.find(item => item.id === optionId);
  const payload = optionId == null ? proposal?.payload : option?.payload;
  const before = site.plan;
  const after = {...before};
  let scope = null;
  if (payload?.kind === 'hold' && Object.keys(payload).length === 1) scope = {kind: 'hold'};
  if (payload?.kind === 'resequence' && Object.keys(payload).every(key =>
    ['kind', 'supplierId', 'agreementId', 'plannedDay', 'assignmentId', 'crewLeadId', 'crewSize', 'shiftAt'].includes(key))
    && Number.isFinite(civilMillis(`${payload.plannedDay}T00:00:00`)) && payload.plannedDay >= BOARD_AT.slice(0, 10)
    && (payload.supplierId == null ? payload.agreementId == null : Object.hasOwn(SUPPLIERS, payload.supplierId)
      && SUPPLIERS[payload.supplierId].agreementId === payload.agreementId)) {
    scope = {kind: 'resequence', plannedDay: payload.plannedDay};
    after.plannedDay = payload.plannedDay;
    if (payload.supplierId != null) {
      after.supplierId = scope.supplierId = payload.supplierId;
      after.agreementId = scope.agreementId = payload.agreementId;
    }
    if (payload.assignmentId != null) {
      if (typeof payload.assignmentId !== 'string' || !Object.hasOwn(DIRECTORY, payload.crewLeadId)
        || !Number.isSafeInteger(payload.crewSize) || payload.crewSize < 1 || !Number.isFinite(civilMillis(payload.shiftAt))
        || payload.shiftAt.slice(0, 10) !== payload.plannedDay) scope = null;
      else Object.assign(scope, {assignmentId: payload.assignmentId, crewLeadId: payload.crewLeadId, crewSize: payload.crewSize, shiftAt: payload.shiftAt});
    } else if (['crewLeadId', 'crewSize', 'shiftAt'].some(key => Object.hasOwn(payload, key))) scope = null;
  }
  const eligible = site.lifecycle === 'open' && !!scope && proposal?.planRev === site.planRev
    && ['Recommended', 'Pending approval', 'Modified'].includes(proposal.state);
  return {proposalId: proposal?.id ?? null, optionId, label: option?.label ?? null, validOption: optionId == null || !!option,
    scope, before, after, eligible: Boolean(eligible), reviewKey: JSON.stringify([proposal?.id, optionId, site.planRev, before, after, scope])};
}

/** Record an intentional forbidden decision; never accept or retain rationale here. */
export function recordApprovalDenial(store, {attempt, commandId, siteId, expectedSiteRev, expectedGeneration,
  expectedSessionEpoch, expectedSessionToken, proposalId, optionId} = {}) {
  const input = {commandId, siteId, expectedSiteRev, expectedGeneration, expectedSessionEpoch, expectedSessionToken, proposalId, optionId};
  if (!DECISIONS.includes(attempt) || !fenced(input)) return commandError('BAD_INPUT', STALE);
  return store.commit(command(input, `denial:${attempt}`, (_board, actor) => !authorize(actor, attempt)), (board, actor) => {
    const site = board.sites[input.siteId];
    const review = previewApproval(site, input.optionId);
    if (review.proposalId !== input.proposalId || (!review.scope && !review.label)) return commandError('STALE_INTENT', STALE);
    const event = eventFor(board.audit, site, actor, 'Approval denied', 'Decision not permitted.', {attemptedVerb: attempt, reasonCode: 'FORBIDDEN'});
    return {writes: {audit: event.audit}, result: commandError('FORBIDDEN', approvalDenialReason(actor))};
  });
}

/** Commit one Priya decision against the reviewed scope and optional modified follow-up.
 *
 * Args:
 *   store: Journaled workshop store; authority comes from its live session.
 *   input: Site fence, command identity, proposal and option, review key, fault
 *     revision, reviewed assignment revision if applicable, verb and rationale.
 * Returns:
 *   The committed decision and any workflow reference, or a safe failure.
 */
export function decide(store, input = {}) {
  const {verb} = input;
  if (!DECISIONS.includes(verb) || !fenced(input)) return commandError('BAD_INPUT', STALE);
  const actor = readAccess(store.getSnapshot());
  if (actor && !authorize(actor, verb)) {
    const {commandId, siteId, expectedSiteRev, expectedGeneration, expectedSessionEpoch, expectedSessionToken, proposalId, optionId} = input;
    return recordApprovalDenial(store, {commandId, siteId, expectedSiteRev, expectedGeneration, expectedSessionEpoch,
      expectedSessionToken, proposalId, optionId, attempt: verb});
  }
  return store.commit(command(input, verb, (_board, liveActor) => authorize(liveActor, verb)), (board, liveActor) => {
    const site = board.sites[input.siteId];
    const review = previewApproval(site, input.optionId);
    if (!review.eligible || review.proposalId !== input.proposalId || review.reviewKey !== input.reviewKey
      || board.faults.rev !== input.expectedFaultRev) return commandError('STALE_INTENT', STALE);
    const rationale = typeof input.rationale === 'string' ? input.rationale.trim() : '';
    if (rationale.length < 12) return commandError('BAD_RATIONALE', 'Enter a rationale of at least 12 characters.');
    const applies = verb === 'approve' || verb === 'override';
    const readiness = readinessFor(board, site);
    const needsReview = readiness.confidence == null || readiness.reviewRequired;
    if (applies && needsReview && input.confidenceReviewed !== true) {
      return commandError('REVIEW_REQUIRED', 'Confirm that you reviewed the evidence and confidence.');
    }
    const assignment = review.scope.assignmentId && board.program.crew.find(item => item.id === review.scope.assignmentId && item.siteId === site.id);
    if (applies && review.scope.assignmentId && (!assignment || assignment.rev !== input.reviewedAssignmentRev)) {
      return commandError('STALE_INTENT', STALE);
    }
    const modified = verb === 'modify';
    const dueDay = modified ? input.dueDay : null;
    const note = modified && typeof input.note === 'string' ? input.note.trim() : null;
    const ownerId = modified ? input.ownerId : null;
    if (modified && (!(Object.hasOwn(USERS, ownerId) || Object.hasOwn(DIRECTORY, ownerId))
      || !Number.isFinite(civilMillis(`${dueDay}T00:00:00`)) || dueDay < BOARD_AT.slice(0, 10) || !note)) {
      return commandError('BAD_MODIFICATION', 'Choose an owner and valid due date, and enter a short note.');
    }
    const after = applies ? review.after : review.before;
    const changed = Object.keys(after).some(key => after[key] !== site.plan[key]);
    const disposition = applies ? `Approved — ${review.scope.kind}` : modified ? 'Modified' : 'Rejected';
    const id = `dec_${board.audit.nextSeq}`;
    const workflowId = applies ? `ECO-${site.id.slice(-4)}-${site.decisions.length + 1}` : null;
    const context = assessed(site);
    const decision = {id, proposalId: review.proposalId, optionId: review.optionId, verb, actorId: liveActor.id, at: BOARD_AT,
      rationale, scope: review.scope, before: review.before, after, effectivePlanRev: site.planRev + Number(changed),
      assessmentRef: context.snapshotId, workflowId, ownerId, dueDay, note, disposition, priorDisposition: site.disposition,
      confidenceReviewed: applies && needsReview && input.confidenceReviewed === true, reviewedEvidenceRev: site.evidenceRev,
      reviewedAssignmentRev: assignment?.rev ?? null};
    const next = {...site, rev: site.rev + 1, planRev: decision.effectivePlanRev, plan: after,
      scoreState: changed ? 'needs_rescore' : site.scoreState, disposition,
      holdActive: site.holdActive || (applies && review.scope.kind === 'hold'),
      decisions: [...site.decisions, decision], proposal: {...site.proposal, state: disposition}};
    if (applies && review.scope.kind === 'hold') next.holdReason = rationale;
    if (modified) Object.assign(next.proposal, {ownerId, dueDay, dueTime: null, note});
    const detail = verb === 'reject' ? `Rejected by ${liveActor.name}` : `${disposition} by ${liveActor.name}`;
    const event = eventFor(board.audit, site, liveActor, verb === 'override' ? 'Override' : applies ? 'Approval' : disposition,
      detail, {...context, decisionId: id, workflowId, rationale});
    const writes = {sites: {...board.sites, [site.id]: next}, audit: event.audit};
    if (workflowId) writes.program = {...board.program, eco: {...board.program.eco,
      [workflowId]: {id: workflowId, siteId: site.id, decisionId: id, scope: review.scope, queuedAt: BOARD_AT, state: 'Queued'}}};
    return {writes, result: {decisionId: id, disposition, workflowId, eventId: event.id, message: workflowId ? `${detail}. ${workflowId} queued locally.` : `${detail}.`}};
  });
}

/** Find approval tied to the current plan and the reviewed assignment, not a status label. */
function applicableApproval(site, assignment, kind) {
  if (!assignment) return null;
  return [...site.decisions].reverse().find(decision => ['approve', 'override'].includes(decision.verb)
    && decision.actorId === PERSON.priya && decision.effectivePlanRev === site.planRev && decision.scope.kind === kind
    && decision.scope.assignmentId === assignment.id && (kind === 'dispatch'
      ? decision.scope.crewLeadId === assignment.leadId && decision.scope.crewSize === assignment.size && decision.scope.shiftAt === assignment.shiftAt
      : (decision.reviewedAssignmentRev === assignment.rev || site.executions.some(item => item.action === 'resequence' && item.approvalId === decision.id))
        && decision.scope.plannedDay === site.plan.plannedDay && decision.scope.shiftAt?.slice(0, 10) === site.plan.plannedDay
        && !!decision.scope.crewLeadId && decision.scope.crewSize > 0)) ?? null;
}

/** Explain crew actions and derive exact authorizations from the committed board. */
export function previewField(board, site, actor) {
  const assignment = board.program.crew.find(item => item.siteId === site.id) ?? null;
  const dispatch = applicableApproval(site, assignment, 'dispatch');
  const resequence = applicableApproval(site, assignment, 'resequence');
  const readiness = readinessFor(board, site);
  const confidence = readiness.confidence;
  const needsReview = confidence == null || confidence < REVIEW_BELOW;
  const reviewed = decision => confidence != null && decision?.confidenceReviewed === true && decision.reviewedEvidenceRev === site.evidenceRev
    && decision.assessmentRef === site.assessment?.snapshotId;
  const reviewReason = `Confidence is ${confidence == null ? 'unknown' : `${confidence}%`}. An approver has to review this site before dispatch.`;
  const base = !authorize(actor, INTENT.dispatch) ? 'Only Andre Cole can record field execution.'
    : site.lifecycle !== 'open' ? site.lifecycle === 'dispatched' ? 'Crew already dispatched.' : 'This site is closed.' : null;
  const inactive = !assignment || !assignment.leadId || !Number.isSafeInteger(assignment.size) || assignment.size < 1
    || !Number.isFinite(civilMillis(assignment.shiftAt)) || /^(?:dispatched|inactive|cancelled|canceled|completed|closed|on site|rolling)\b/i.test(assignment.state);
  const holdReason = site.holdActive ? site.id === 'NRO-W-1842' && site.rows.Power.status === 'Not Ready' ? 'Power is Not Ready and the site is on hold.'
    : site.id === 'NRO-W-1891' && site.rows.Power.status === 'Not Ready' ? 'Power is Not Ready after the 8 May failed visit.'
      : site.holdReason ?? 'The site is on hold.' : null;
  const option = site.proposal?.alternatives.find(item => item.id === 'opt_1842_north_gate') ?? null;
  const resequenced = !!resequence && site.executions.some(item => item.action === 'resequence' && item.approvalId === resequence.id);
  const heldCrew = /^hold\b|^held\b/i.test(assignment?.state ?? '') || site.executions.some(item => item.action === 'hold' && item.assignmentId === assignment?.id);
  const holdApproval = [...site.decisions].reverse().find(item => item.effectivePlanRev === site.planRev && item.scope.kind === 'hold'
    && ['approve', 'override'].includes(item.verb) && item.actorId === PERSON.priya) ?? null;
  return {assignment, option, holdReason, held: site.holdActive || heldCrew, approvals: {dispatch, hold: holdApproval, resequence}, reasons: {
    dispatch: base ?? holdReason ?? (heldCrew ? 'The assigned crew is on hold.' : null)
      ?? (needsReview && !reviewed(dispatch) ? reviewReason : null) ?? (inactive ? 'No active crew assignment.' : null)
      ?? (!readiness.mandatoryReady ? 'Dispatch requires all mandatory evidence to be Current and Ready.' : null)
      ?? (!readiness.current ? 'Dispatch requires a current assessment.' : null)
      ?? (!dispatch ? 'No dispatch-specific approval matches this crew and plan.' : null),
    hold: base ?? (needsReview && !reviewed(holdApproval) ? reviewReason : null) ?? (inactive ? 'No active crew assignment.' : null)
      ?? (heldCrew ? holdReason ?? 'Crew hold is already recorded.' : null),
    resequence: base ?? (needsReview && !reviewed(resequence) ? reviewReason : null) ?? (inactive ? 'No active crew assignment.' : null)
      ?? (resequenced ? 'Crew resequence already recorded.' : null) ?? (!resequence ? 'Approval is required for the date move.' : null),
  }};
}

/** Capture the exact assignment, approval and revisions before opening confirmation. */
export function fieldConfirmation(store, board, site, field, action) {
  const assignment = field.assignment;
  if (!Object.hasOwn(FIELD, action) || field.reasons[action] || !assignment) return null;
  return {...siteFence(store, board, site), action, assignmentId: assignment.id, assignmentRev: assignment.rev,
    approvalId: field.approvals[action]?.id ?? null, expectedFaultRev: board.faults.rev};
}

/** Execute one confirmed field action after rebuilding the live gates and scope.
 *
 * Args:
 *   store: Journaled workshop store providing the live session and program.
 *   input: A command identity and the fence returned by fieldConfirmation.
 * Returns:
 *   The committed local disposition and audit reference, or a safe failure.
 */
export function executeField(store, input = {}) {
  const {action, assignmentId, assignmentRev, approvalId} = input;
  if (!Object.hasOwn(FIELD, action) || !fenced(input) || typeof assignmentId !== 'string' || !Number.isSafeInteger(assignmentRev)
    || !Number.isSafeInteger(input.expectedFaultRev) || !(approvalId === null || typeof approvalId === 'string')) {
    return commandError('BAD_INPUT', STALE);
  }
  const intent = FIELD[action];
  return store.commit({...command(input, [intent, assignmentId, assignmentRev, approvalId], (_board, actor) => authorize(actor, intent)),
    assignmentId, assignmentRev}, (board, actor) => {
    const site = board.sites[input.siteId];
    const field = previewField(board, site, actor);
    const approval = field.approvals[action];
    if (board.faults.rev !== input.expectedFaultRev || field.assignment?.id !== assignmentId || (approval?.id ?? null) !== approvalId) {
      return commandError('STALE_INTENT', STALE);
    }
    if (field.reasons[action]) return commandError('FIELD_BLOCKED', field.reasons[action]);
    const dispatch = action === 'dispatch';
    const hold = action === 'hold';
    const disposition = dispatch ? 'Dispatched' : hold ? 'Hold' : 'Approved — resequence';
    const frozenApproval = approval && board.audit.events.find(event => event.decisionId === approval.id);
    const context = approval ? {snapshotId: approval.assessmentRef, model: frozenApproval?.model ?? null,
      correlationId: frozenApproval?.correlationId ?? null, output: frozenApproval?.output ?? null, confidence: frozenApproval?.confidence ?? null}
      : assessed(site);
    const execution = {id: `exec_${board.audit.nextSeq}`, action, actorId: actor.id, at: BOARD_AT, assignmentId, approvalId,
      planRev: site.planRev, evidenceRev: site.evidenceRev, snapshotId: context.snapshotId};
    const crew = {...field.assignment, rev: assignmentRev + 1, state: dispatch ? 'Dispatched' : hold || site.holdActive ? 'Hold' : 'Resequenced'};
    if (action === 'resequence') Object.assign(crew, {leadId: approval.scope.crewLeadId, size: approval.scope.crewSize,
      shiftAt: approval.scope.shiftAt, shiftDay: approval.scope.plannedDay});
    const next = {...site, rev: site.rev + 1, disposition, lifecycle: dispatch ? 'dispatched' : site.lifecycle,
      holdActive: hold || site.holdActive, executions: [...site.executions, execution]};
    const message = dispatch ? `Disposition updated. Crew dispatched to ${site.name}.` : hold ? `Crew hold recorded for ${site.name}.` : `Crew resequence recorded for ${site.name}.`;
    const event = eventFor(board.audit, site, actor, dispatch ? 'Dispatched' : 'Disposition', message,
      {...context, decisionId: approvalId, executionEvidenceRev: site.evidenceRev, executionId: execution.id});
    return {writes: {sites: {...board.sites, [site.id]: next}, audit: event.audit,
      program: {...board.program, crew: board.program.crew.map(item => item.id === assignmentId ? crew : item)}},
    result: {disposition, executionId: execution.id, eventId: event.id, message}};
  });
}

/** Return site history newest first without mutating the committed audit. */
export function siteAudit(board, siteId) {
  return board.audit.events.filter(event => event.siteId === siteId).sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq);
}
