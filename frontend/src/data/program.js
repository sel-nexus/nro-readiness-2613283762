/** Preserve the program, local-source and historical fixture records in PRD order. */
import {freezeTree, PERSON} from './people.js';
import {civil, MODEL, MORNING_SCORE_AT, REGISTER, SUPPLIERS} from './register.js';

/** Expand a released or historical site number; preserve an unassigned shift. */
const sid = number => number == null ? null : `NRO-W-${number}`;

export const NOTES = freezeTree([
  ['05-12 08:50', 1851, 'elena', 'City portal has not posted a new inspection since 22 Apr. Chasing Denise.'],
  ['05-12 08:15', 1842, 'marcus', 'Do not roll Harbor Point on the 18th unless power flips to Ready.'],
  ['05-11 17:05', 1855, 'omar', 'DDL shows the antenna kit short. DPAM still says issued. I will not call this Ready.'],
  ['05-11 16:40', 1842, 'elena', 'Called Ruth. Utility window is 15 May if the cutover holds. Asking Marcus to keep the crew on hold.'],
  ['05-11 15:10', 1847, 'andre', 'Brief signed. Crew is Luis Ortega on the 16th.'],
  ['05-11 09:20', 1866, 'priya', 'I will review the supplier move on the 12th.'],
  ['05-11 07:48', 1822, 'helen', 'On site. Access good. Install started.'],
  ['05-10 11:05', 1866, 'marcus', 'Northwind cannot energize by the 15th. Civic Civil can take the pad on the 19th. Needs Priya.'],
  ['05-10 09:12', 1860, 'andre', 'Crew not confirmed. Fieldcrew West has that shift on another cluster.'],
  ['05-09 10:00', 1891, 'priya', 'Rework stays with Northwind. Reattempt 26 May. No supplier change yet.'],
  ['05-08 18:20', 1891, 'andre', 'Aborted. The crew waited 40 minutes. Logging a failed visit.'],
].map(([time, number, actor, text], i) => ({siteId: sid(number), note: {id: `note_seed_${i + 1}`, at: civil(time), actorId: PERSON[actor], text}})));

export const UPLOADS = freezeTree(Object.fromEntries([
  ['doc_1842_power', 1842, 'Power', 'harbor-point-power-note.pdf', 186000, 'elena', '05-11 16:22', 'Northwind Power. Commercial power not available. Next crew window 15 May 2026. Agreement AGR-NW-2291.'],
  ['doc_1851_permit', 1851, 'Permit', 'lakeside-permit-scan.pdf', 240000, 'denise', '04-22 14:20', 'City of Alameda permit PLN-4418 issued 2 Apr 2026. No later inspection on file.'],
  ['doc_1891_fail', 1891, 'Power', 'point-richmond-failed-visit.pdf', 96000, 'andre', '05-08 18:10', 'Crew arrived 8 May 07:20. Commercial power absent. Visit aborted after 40 minutes. No install.'],
  ['doc_1847_brief', 1847, 'Workforce', 'civic-center-crew-brief.pdf', 120000, 'andre', '05-11 15:00', 'Civic Center ready. Luis Ortega, crew of 4, 16 May 07:00. Depot West Metro Yard.'],
  ['doc_1822_photo', 1822, 'Civil', 'jack-london-arrival.jpg', 1400000, 'helen', '05-11 07:40', 'Arrival photo, Jack London. Gate open, pad clear, crew of 4 on site.'],
].map(([id, number, row, fileName, sizeBytes, actor, time, extractedText]) => [id, {id, siteId: sid(number), row, fileName,
  sizeBytes, mediaType: fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', addedBy: PERSON[actor],
  addedAt: civil(time), extractedText, extractionState: 'available'}])));

const actorLabels = {priya: 'Priya Raman', marcus: 'Marcus Hale', elena: 'Elena Voss', andre: 'Andre Cole',
  helen: 'Helen Cho', marco: 'Marco Diaz', denise: 'Denise Park', omar: 'Omar Shah', ruth: 'Ruth Ibarra',
  irene: 'Irene Walsh', noah: 'Noah Grant', model: MODEL, ddl: 'DDL sync', system: 'NRO Readiness'};

export const ACTIVITIES = freezeTree([
  ['04-18 11:00', 'elena', 'On air', 1766, 'Rework closed. Site left the board.'],
  ['04-22 14:10', 'denise', 'Evidence updated', 1851, 'Permit scan posted. Later marked stale.'],
  ['04-29 15:30', 'elena', 'On air', 1794, 'Resequence finished. On air.'],
  ['05-04 15:00', 'model', 'Scored', 1810, '96% / confidence 94% at close.'],
  ['05-04 16:45', 'marcus', 'On air', 1810, 'On air.'],
  ['05-05 17:20', 'andre', 'Evidence updated', 1816, 'Workforce confirmed before close.'],
  ['05-06 13:00', 'model', 'Scored', 1816, '95% / confidence 93% at close.'],
  ['05-06 14:20', 'marcus', 'On air', 1816, 'On air.'],
  ['05-07 13:40', 'noah', 'Evidence updated', 1872, 'Transmission file missing. Status left Unavailable.'],
  ['05-07 18:05', 'andre', 'Evidence updated', 1860, 'Workforce left Not Ready.'],
  ['05-08 07:20', 'andre', 'Failed visit', 1891, 'Crew aborted. Power absent.'],
  ['05-08 08:10', 'omar', 'Evidence updated', 1838, 'Material count posted. Now stale.'],
  ['05-08 18:20', 'andre', 'Document added', 1891, 'point-richmond-failed-visit.pdf'],
  ['05-09 10:00', 'priya', 'Disposition', 1891, 'Hold. Reattempt 26 May. Supplier unchanged. Rationale: “Keep Northwind on the rework. A supplier change is not justified yet.”'],
  ['05-10 09:12', 'andre', 'Note', 1860, 'Crew not confirmed.'],
  ['05-10 11:05', 'marcus', 'Note', 1866, 'Northwind cannot energize by the 15th.'],
  ['05-10 16:45', 'irene', 'Evidence updated', 1878, 'Civil moved to In progress.'],
  ['05-11 06:50', 'helen', 'Dispatched', 1822, 'Crew rolling.'],
  ['05-11 07:48', 'helen', 'Note', 1822, 'On site. Install started.'],
  ['05-11 09:20', 'priya', 'Note', 1866, 'Will review the supplier move on the 12th.'],
  ['05-11 10:15', 'omar', 'Evidence updated', 1855, 'DPAM says material Ready.'],
  ['05-11 15:00', 'andre', 'Document added', 1847, 'civic-center-crew-brief.pdf'],
  ['05-11 15:40', 'model', 'Scored', 1847, '92% / confidence 90% / corr_1847_a'],
  ['05-11 15:45', 'priya', 'Approval', 1847, 'Approved dispatch for 16 May. Rationale: “Evidence is current and no prerequisite is open.”'],
  ['05-11 16:10', 'ruth', 'Evidence updated', 1842, 'Power set to Not Ready.'],
  ['05-11 16:22', 'elena', 'Document added', 1842, 'harbor-point-power-note.pdf'],
  ['05-11 16:40', 'ddl', 'Evidence updated', 1855, 'DDL says material Not Ready. Row marked Conflicting.'],
  ['05-11 16:40', 'elena', 'Note', 1842, 'Called Ruth. Window is 15 May if the cutover holds.'],
  ['05-11 17:05', 'omar', 'Note', 1855, 'Will not call material Ready.'],
  ['05-11 17:20', 'ruth', 'Evidence updated', 1866, 'Power set to In progress.'],
  ['05-12 06:20', 'marco', 'Dispatched', 1828, 'Crew out at 07:00.'],
  ['05-12 07:15', 'omar', 'Evidence updated', 1834, 'Material on site this morning.'],
  ['05-12 08:15', 'marcus', 'Note', 1842, 'Do not roll the 18 May crew.'],
  ['05-12 08:50', 'elena', 'Note', 1851, 'Chasing a new city inspection.'],
  ['05-12 09:34', 'model', 'Scored', 1842, '34% / confidence 86% / corr_1842_a'],
  ['05-12 09:34', 'system', 'Recommended', 1842, 'Hold the 18 May crew.'],
  ['05-12 09:35', 'marcus', 'Disposition', 1842, 'Hold.'],
].map(([time, actor, verb, number, detail], i) => ({id: `feed_seed_${i + 1}`, siteId: sid(number), at: civil(time),
  actorLabel: actorLabels[actor], actorId: PERSON[actor] ?? actor, actorKind: PERSON[actor] ? 'person' : actor === 'ddl' ? 'source' : actor,
  verb, detail, seq: i + 1})));

const crew = [
  ['05-11 07:00', 1822, 'helen', 4, 'On site since yesterday'],
  ['05-12 07:00', 1828, 'marco', 3, 'Rolling this morning'],
  ['05-13', null, null, null, 'No install. Hold day for power checks.'],
  ['05-14 07:00', 1834, 'luis', 4, 'Planned, ready for dispatch'],
  ['05-15 07:00', 1866, 'luis', 4, 'Blocked pending Priya'],
  ['05-16 07:00', 1847, 'luis', 4, 'Approved, not yet dispatched'],
  ['05-18 07:00', 1842, 'luis', 4, 'Hold'],
  ['05-19 07:00', 1855, 'helen', 4, 'Watch, material conflict'],
  ['05-20 07:00', 1851, 'marco', 3, 'Needs a fresh permit'],
  ['05-26 07:00', 1891, 'helen', 4, 'Hold, reattempt'],
].map(([shift, number, lead, size, state], i) => ({id: number ? `crew_${number}` : `crew_hold_${i + 1}`, rev: 0,
  siteId: sid(number), leadId: PERSON[lead] ?? null, size, depot: number ? 'West Metro Yard' : null,
  shiftDay: civil(shift.split(' ')[0]), shiftAt: shift.includes(' ') ? civil(shift) : null, state}));

const failures = [
  [1766, 'Mandela Parkway', '04-02', 'Crew arrived and the permit was pulled that morning.', 'Rework finished. On air 18 Apr 2026. Not on the current board.', null],
  [1794, 'San Pablo Ave', '04-21', 'Material was not on site.', 'Resequenced. On air 29 Apr 2026. Not on the current board.', null],
  [1891, 'Point Richmond', '05-08 07:20', 'Helen Cho’s crew waited 40 minutes. Commercial power was absent. Visit aborted.', 'Open. On the board as Hold. Reattempt 26 May 2026.', '05-26'],
].map(([number, name, when, outcome, detail, reattempt]) => ({id: `fail_${number}`, siteId: sid(number), name,
  whenDay: civil(when.split(' ')[0]), whenAt: when.includes(' ') ? civil(when) : null,
  outcome, state: reattempt ? 'Open' : 'Closed', detail, reattemptDay: civil(reattempt)}));

const design = [
  [1902, 'Albany Hill', 'Albany, Albany Hill', 'Design', '2026-06'],
  [1908, 'Berkeley Marina', 'Berkeley, Marina', 'Design', '2026-06'],
  [1914, 'Emeryville Greenway', 'Emeryville, Greenway', 'Design', '2026-06'],
  [1920, 'Oakland Estuary', 'Oakland, Estuary', 'Awaiting permit intake', '2026-06'],
  [1926, 'Richmond Annex', 'Richmond, Annex', 'Design', '2026-07'],
  [1932, 'Alameda Point', 'Alameda, Alameda Point', 'Design', '2026-07'],
].map(([number, name, neighborhood, state, targetMonth]) => ({siteId: sid(number), name, neighborhood, state, targetMonth}));

const notices = [
  [1842, 'Harbor Point power still Not Ready · Ruth Ibarra · due 13 May 15:00'],
  [1866, 'Portside supplier change is waiting on Priya Raman · due today'],
  [1851, 'Lakeside permit evidence is stale · Denise Park'],
  [1891, 'Point Richmond failed visit is still open · reattempt 26 May'],
  [1860, 'Hillcrest crew unconfirmed · Andre Cole · confidence 48%'],
  [1855, 'Market DAS material conflict · Omar Shah'],
  [1838, 'Dimond material update is 4 days old · Omar Shah'],
  [1872, 'East Yard transmission evidence is missing · Noah Grant'],
  [1810, 'Fruitvale on air 4 May · closed'],
  [1816, 'Temescal on air 6 May · closed'],
  [1822, 'Jack London crew on site · Helen Cho'],
  [1828, 'Piedmont Ave dispatched 07:00 today · Marco Diaz'],
].map(([number, text], i) => ({id: `notice_seed_${i + 1}`, text, unread: i < 8, seedSeq: i + 1, siteId: sid(number)}));

const sources = Object.fromEntries([
  ['DPAM', '09:34', 'Up', '16 site records'],
  ['POS', '09:31', 'Up', 'Baseline dates unchanged except Portside’s pending request'],
  ['DDL', '09:22', 'Up', 'Market DAS conflict still open'],
  ['ECO', '08:55', 'Up', 'No queued live action. Civic Center approval is local only.'],
  ['City portal', '07:10', 'Delayed', 'Lakeside inspection not refreshed'],
  ['Northwind Power feed', '09:28', 'Up', 'Harbor Point and Point Richmond still Not Ready'],
  ['Assessment', '09:34', 'Up', 'Last score 09:34.'],
].map(([sourceId, time, state, detail]) => [sourceId, {sourceId, state, lastSyncAt: civil(`05-12 ${time}`), detail}]));

const trend = [71, 71, 69, 69, 67, 73, 73, 75, 75, 63, 63, 56, 56, 50].map((greenShare, i) => ({
  day: civil(i < 2 ? `04-${29 + i}` : `05-${String(i - 1).padStart(2, '0')}`), greenShare,
}));

export const PROGRAM = freezeTree({
  name: 'Harbor Ring densification', cluster: 'West Metro Cluster 4', region: 'West Metro', quarter: 'Q2 2026',
  openedDay: civil('04-06'), leadId: PERSON.marcus, managerId: PERSON.priya, suppliers: SUPPLIERS,
  crew, failures, design, notices, morning: ACTIVITIES.map(({actorId, actorKind, ...entry}) => ({
    ...entry, siteName: REGISTER[entry.siteId]?.name ?? failures.find(failure => failure.siteId === entry.siteId).name,
  })), trend, sources, visitsAtStake: [sid(1842), sid(1860)], eco: {},
  lastScore: {siteId: sid(1842), model: MODEL, scoredAt: MORNING_SCORE_AT, correlationId: 'corr_1842_a', snapshotId: 'snap_1842_0934'},
});
