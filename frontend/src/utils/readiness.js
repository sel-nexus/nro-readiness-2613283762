/** Project current eligibility without changing the score or granting authority. */
import {BOARD_AT, REGISTER, ROW_ORDER} from '../data/register.js';

const DAY = 86400000;
export const FRESHNESS_DAYS = Object.freeze({Permit: 14, Civil: 7, Power: 7, Transmission: 7, Material: 3, Workforce: 2});
export const MANDATORY = Object.freeze(['Permit', 'Power', 'Transmission', 'Material']);
export const REVIEW_BELOW = 60;
export const RESCORE_NOTICE = 'Evidence changed. Run assessment to rescore.';

/** Parse a canonical board-clock timestamp without using the browser time zone. */
export function civilMillis(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value ? time : NaN;
}

/** Resolve missing and disputed observations before measuring elapsed time. */
export function rowQuality(row, clock = BOARD_AT) {
  if (row.quality === 'Conflicting') return 'Conflicting';
  const age = civilMillis(clock) - civilMillis(row.sourceAt);
  if (row.quality === 'Missing' || !Number.isFinite(age) || age < 0) return 'Missing';
  return age > FRESHNESS_DAYS[row.row] * DAY ? 'Stale' : 'Current';
}

/** Return the inclusive date window for an open-site forecast. */
export function forecastWindow(clock = BOARD_AT) {
  const start = clock.slice(0, 10);
  const end = new Date(civilMillis(`${start}T00:00:00`) + 21 * DAY).toISOString().slice(0, 10);
  return {start, end};
}

/** Test the exact date boundary independently of the time of day. */
export function inHorizon(day, clock = BOARD_AT) {
  const {start, end} = forecastWindow(clock);
  return typeof day === 'string' && Number.isFinite(civilMillis(`${day}T00:00:00`)) && day >= start && day <= end;
}

/** Determine whether the service, not an evidence source, is interrupted. */
export const assessmentIsDown = faults => Boolean(faults?.assessmentDown || faults?.scenarioAssessmentDown);

/** Label confidence bands independently of the review threshold. */
export const confidenceBand = value => value == null ? 'Unknown' : value >= 75 ? 'High' : value >= 50 ? 'Medium' : 'Low';

/** Recalculate working risk and safety gates while keeping the previous result intact.
 *
 * Args:
 *   site: Working site record, including its last recorded assessment.
 *   clock: Fixed board clock for freshness and forecast horizon.
 *   faults: Independent workshop fault settings.
 *   snapshot: Optional immutable inputs from the recorded assessment.
 * Returns:
 *   Quality, risk, forecast availability and prerequisites, not dispatch approval.
 */
export function deriveReadiness(site, clock = BOARD_AT, faults, snapshot) {
  const {assessment: lastScore, lifecycle, plan, scoreState} = site;
  const open = lifecycle === 'open';
  const horizonEligible = open && inHorizon(plan.plannedDay, clock);
  const quality = Object.fromEntries(ROW_ORDER.map(key => [key, open ? rowQuality(site.rows[key], clock) : site.rows[key].quality]));
  const mandatoryReady = MANDATORY.every(key => quality[key] === 'Current' && site.rows[key].status === 'Ready');
  const mandatoryNotReady = MANDATORY.some(key => quality[key] === 'Current' && site.rows[key].status === 'Not Ready');
  const unresolved = MANDATORY.some(key => quality[key] !== 'Current');
  const evidenceChanged = Boolean(lastScore && lastScore.evidenceRev !== site.evidenceRev);
  const staleInput = ROW_ORDER.some(key => quality[key] === 'Stale' &&
    (snapshot?.rows.find(row => row.row === key)?.quality ?? REGISTER[site.id]?.rows[key].quality ?? site.rows[key].quality) !== 'Stale');
  const current = Boolean(horizonEligible && lastScore && !evidenceChanged && !staleInput && lastScore.planRev === site.planRev &&
    lastScore.plannedDay === plan.plannedDay && ['current', 'unavailable'].includes(scoreState) && !assessmentIsDown(faults));
  const probability = current || lifecycle === 'dispatched' ? lastScore?.probability ?? null : null;
  let confidence = lastScore?.confidence ?? null;
  if (open && staleInput && confidence >= 50) confidence = confidence >= 75 ? 74 : 49;
  if (open && faults?.forceLowConfidence && site.id === 'NRO-W-1860' && confidence != null) confidence = Math.min(confidence, 48);
  const red = (probability != null && probability < 50) || (confidence != null && confidence < 50) || mandatoryNotReady;
  const risk = lifecycle === 'on_air' ? 'Green' : !open ? site.risk : red ? 'Red'
    : probability == null || probability < 80 || confidence == null || confidence < 75 || unresolved ? 'Amber' : 'Green';
  const reviewRequired = confidence != null && confidence < REVIEW_BELOW;
  const ready = open && current && mandatoryReady && risk === 'Green';
  const disposition = open && ['Ready', 'Ready for dispatch'].includes(site.disposition) && !ready
    ? 'Needs review' : site.disposition;
  return {quality, risk, disposition, mandatoryReady, mandatoryNotReady, horizonEligible, evidenceChanged, current, probability,
    confidence, confidenceBand: confidenceBand(confidence), lastScore, ready, reviewRequired,
    dispatchEligible: current && mandatoryReady && confidence >= REVIEW_BELOW && !site.holdActive};
}
