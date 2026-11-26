/** Project current eligibility without changing the score or granting authority. */
import {BOARD_AT, REGISTER, ROW_ORDER} from '../data/register.js';

const DAY = 86400000;
export const FRESHNESS_DAYS = Object.freeze({Permit: 14, Civil: 7, Power: 7, Transmission: 7, Material: 3, Workforce: 2});
export const MANDATORY = Object.freeze(['Permit', 'Power', 'Transmission', 'Material']);
export const REVIEW_BELOW = 60;
export const DEFAULT_THRESHOLDS = Object.freeze({goodProbability: 80, goodConfidence: 75, attentionFrom: 50,
  dispatchBelow: REVIEW_BELOW, freshness: FRESHNESS_DAYS});
export const RESCORE_NOTICE = 'Evidence changed. Run assessment to rescore.';

/** Validate a complete settings record before accepting or reading it. */
export function validThresholds(value) {
  const percent = number => Number.isSafeInteger(number) && number >= 0 && number <= 100;
  return !!value && ['goodProbability', 'goodConfidence', 'attentionFrom', 'dispatchBelow'].every(key => percent(value[key]))
    && value.attentionFrom <= Math.min(value.goodProbability, value.goodConfidence)
    && !!value.freshness && ROW_ORDER.every(key => Number.isSafeInteger(value.freshness[key]) && value.freshness[key] >= 0);
}

/** Parse a canonical board-clock timestamp without using the browser time zone. */
export function civilMillis(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value ? time : NaN;
}

/** Resolve missing and disputed observations before measuring elapsed time. */
export function rowQuality(row, clock = BOARD_AT, freshness = FRESHNESS_DAYS) {
  if (row.quality === 'Conflicting') return 'Conflicting';
  const age = civilMillis(clock) - civilMillis(row.sourceAt);
  if (row.quality === 'Missing' || !Number.isFinite(age) || age < 0) return 'Missing';
  return age > freshness[row.row] * DAY ? 'Stale' : 'Current';
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
 *   thresholds: Current label and dispatch settings, not assessment inputs.
 * Returns:
 *   Quality, risk, forecast availability and prerequisites, not dispatch approval.
 */
export function deriveReadiness(site, clock = BOARD_AT, faults, snapshot, thresholds = DEFAULT_THRESHOLDS) {
  const {assessment: lastScore, lifecycle, plan, scoreState} = site;
  const open = lifecycle === 'open';
  const horizonEligible = open && inHorizon(plan.plannedDay, clock);
  const scoredQuality = Object.fromEntries(ROW_ORDER.map(key => [key, open ? rowQuality(site.rows[key], clock) : site.rows[key].quality]));
  const quality = thresholds.freshness === FRESHNESS_DAYS || !open ? scoredQuality
    : Object.fromEntries(ROW_ORDER.map(key => [key, rowQuality(site.rows[key], clock, thresholds.freshness)]));
  const mandatoryReady = MANDATORY.every(key => scoredQuality[key] === 'Current' && quality[key] === 'Current' && site.rows[key].status === 'Ready');
  const mandatoryNotReady = MANDATORY.some(key => (scoredQuality[key] === 'Current' || quality[key] === 'Current') && site.rows[key].status === 'Not Ready');
  const unresolved = MANDATORY.some(key => quality[key] !== 'Current');
  const evidenceChanged = Boolean(lastScore && lastScore.evidenceRev !== site.evidenceRev);
  const staleInput = ROW_ORDER.some(key => scoredQuality[key] === 'Stale' &&
    (snapshot?.rows.find(row => row.row === key)?.quality ?? REGISTER[site.id]?.rows[key].quality ?? site.rows[key].quality) !== 'Stale');
  const current = Boolean(horizonEligible && lastScore && !evidenceChanged && !staleInput && lastScore.planRev === site.planRev &&
    lastScore.plannedDay === plan.plannedDay && ['current', 'unavailable'].includes(scoreState) && !assessmentIsDown(faults));
  const probability = current || lifecycle === 'dispatched' ? lastScore?.probability ?? null : null;
  let confidence = lastScore?.confidence ?? null;
  if (open && staleInput && confidence >= 50) confidence = confidence >= 75 ? 74 : 49;
  if (open && faults?.forceLowConfidence && site.id === 'NRO-W-1860' && confidence != null) confidence = Math.min(confidence, 48);
  const red = (probability != null && probability < thresholds.attentionFrom)
    || (confidence != null && confidence < thresholds.attentionFrom) || mandatoryNotReady;
  const risk = lifecycle === 'on_air' ? 'Green' : !open ? site.risk : red ? 'Red'
    : probability == null || probability < thresholds.goodProbability || confidence == null || confidence < thresholds.goodConfidence || unresolved ? 'Amber' : 'Green';
  const reviewRequired = confidence != null && confidence < REVIEW_BELOW;
  const dispatchBlocked = confidence == null || confidence < thresholds.dispatchBelow;
  const ready = open && current && mandatoryReady && risk === 'Green';
  const disposition = open && ['Ready', 'Ready for dispatch'].includes(site.disposition) && !ready
    ? 'Needs review' : site.disposition;
  return {quality, risk, disposition, mandatoryReady, mandatoryNotReady, horizonEligible, evidenceChanged, current, probability,
    confidence, confidenceBand: confidenceBand(confidence), lastScore, ready, reviewRequired, dispatchBlocked,
    dispatchMinimum: thresholds.dispatchBelow, dispatchEligible: current && mandatoryReady && !dispatchBlocked && !site.holdActive};
}
