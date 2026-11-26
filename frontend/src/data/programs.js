/** Define independent workshop programs while retaining the original West Metro seed. */
import {captureSnapshot, makeBaseline} from './baseline.js';
import {freezeTree, PERSON} from './people.js';
import {civil, MODEL, ROW_ORDER, SUPPLIERS} from './register.js';

export const DEFAULT_PROGRAM = 'west-metro';
export const PROGRAMS = freezeTree({
  [DEFAULT_PROGRAM]: {name: 'West Metro Cluster 4', region: 'West Metro', quarter: 'Q2 2026', state: 'Active',
    lead: 'Priya Raman', lastUpdate: 'Last scored 12 May 2026, 09:34', letter: 'W', focus: 'NRO-W-1842',
    decision: 'Harbor Point is on hold. Power is not ready.'},
  'east-bay': {name: 'East Bay Cluster 2', region: 'East Bay', quarter: 'Q2 2026', state: 'In build',
    lead: 'Marcus Hale', lastUpdate: '12 May 2026, 09:10', letter: 'E', focus: 'NRO-E-2101',
    decision: 'Delta Landing is on hold. The utility handoff is incomplete.'},
  'north-valley': {name: 'North Valley Cluster 1', region: 'North Valley', quarter: 'Q3 2026', state: 'Just started',
    lead: 'Elena Voss', lastUpdate: '9 May 2026, 16:20', letter: 'N', focus: 'NRO-N-3101',
    decision: 'Orchard Exchange needs a permit before the pilot visit can proceed.'},
  'south-shore': {name: 'South Shore Cluster 7', region: 'South Shore', quarter: 'Q2 2026', state: 'Paused',
    lead: 'Andre Cole', lastUpdate: '8 May 2026, 11:05', letter: 'S', focus: 'NRO-S-7101',
    decision: 'Dune Crossing remains on hold after a failed visit. Site access is not ready.'},
});

const configurations = {
  'east-bay': {update: '05-12 09:10', lead: 'marcus', depot: 'Delta Works Yard', trend: [58,58,58,67,67,67,67,75,75,67,67,67,75,75], sites: [
    [2101, 'Delta Landing', 'Suisun Waterfront', '05-18', 36, 85, 'Power', 'Utility handoff incomplete', 'ruth'],
    [2102, 'Marsh Junction', 'Bay Point Industrial District', '05-19', 67, 82, 'Civil', 'Supplier and baseline date change waiting', 'priya'],
    [2103, 'Copperline Depot', 'Pittsburg Rail Corridor', '05-20', 72, 74, 'Material', 'Antenna rack count pending', 'omar'],
    [2104, 'Willow Span', 'Concord Northbank', '05-16', 89, 91, null, 'None', 'marcus'],
    [2105, 'Tern Island', 'Martinez Tidelands', '05-17', 84, 86, null, 'None', 'noah'],
    [2106, 'Canal Works', 'Antioch Canal District', '05-20', 92, 88, null, 'None', 'irene'],
    [2107, 'Brickyard East', 'Clayton Foundry Quarter', '05-21', 87, 82, null, 'None', 'elena'],
    [2108, 'Vine Terrace', 'Oakley Vineyards', '05-22', 95, 92, null, 'None', 'luis'],
    [2109, 'Cypress Market', 'Brentwood Market Square', '05-23', 82, 86, null, 'None', 'denise'],
    [2110, 'Crosswind Ridge', 'Byron Foothills', '05-24', 88, 79, null, 'None', 'andre'],
    [2111, 'Silver Ferry', 'Bethel Island Landing', '05-25', 91, 89, null, 'None', 'helen'],
    [2112, 'Beacon Spur', 'Discovery Bay Levee', '05-27', 85, 80, null, 'None', 'marco'],
  ]},
  'north-valley': {update: '05-09 16:20', lead: 'elena', depot: 'Orchard Field Depot', trend: [0,0,0,0,0,0,0,0,0,50,50,50,50,50], sites: [
    [3101, 'Orchard Exchange', 'Mill Creek Orchard District', '06-01', 64, 78, 'Permit', 'Pilot permit under review', 'denise'],
    [3102, 'Granite Creek', 'Auburn Mill Quarter', '06-02', 85, 83, null, 'None', 'elena'],
  ], design: [
    [3103, 'Pine Switch', 'Colfax Ridge', '07-06', 62, 'Survey sign-off pending', 'irene'],
    [3104, 'Fern Basin', 'Foresthill Basin', '07-09', 55, 'Access plan in design', 'elena'],
    [3105, 'Cedar Cut', 'Meadow Vista Cut', '07-14', 57, 'Permit intake pending', 'denise'],
    [3106, 'Raven Trail', 'Applegate Trailhead', '07-20', 59, 'Route survey pending', 'noah'],
    [3107, 'Quartz Meadows', 'Grass Valley Meadows', '08-04', 61, 'Pad layout in design', 'irene'],
    [3108, 'Summit Relay', 'Dutch Flat Pass', '08-10', 54, 'Power routing in design', 'ruth'],
  ]},
  'south-shore': {update: '05-08 11:05', lead: 'andre', depot: 'Coast Operations Yard', trend: [75,75,75,75,75,75,75,75,50,50,50,50,25,25], sites: [
    [7101, 'Dune Crossing', 'Moss Landing Dunes', '05-26', 31, 82, 'Permit', 'Site access permit suspended', 'denise'],
    [7102, 'Saltworks Lane', 'Marina Salt Flats', '05-27', 56, 72, 'Civil', 'Pad inspection pending', 'irene'],
    [7103, 'Pelican Station', 'Seaside Bluff', '05-28', 83, 82, null, 'None', 'andre'],
    [7104, 'Breakwater South', 'Monterey Outer Harbor', '05-29', 69, 77, 'Transmission', 'Splice survey incomplete', 'noah'],
  ]},
};
const feeds = ['City portal', 'DPAM', 'Northwind Power feed', 'DDL', 'Brightline Materials', 'Fieldcrew West'];

/** Return a scoped workspace URL, keeping historical West Metro paths unqualified. */
export function programPath(path, programId) {
  return programId === DEFAULT_PROGRAM ? path : `${path}?${new URLSearchParams({program: programId})}`;
}

/** Infer site ownership from the stable, globally unique register identifier. */
export function siteProgram(siteId) {
  return Object.entries(PROGRAMS).find(([, {letter}]) => siteId.startsWith(`NRO-${letter}-`))?.[0];
}

/** Build one non-West site with independent evidence, decision and score references. */
function buildSite(meta, scoreTime, entry, index) {
  const [number, name, neighborhood, day, probability, confidence, blockerRow, blocker, owner] = entry;
  const id = `NRO-${meta.letter}-${number}`;
  const ownerId = PERSON[owner];
  const waiting = id === 'NRO-E-2102';
  const critical = probability < 50;
  const supplierId = blockerRow === 'Power' ? 'northwind' : 'civic';
  const plannedDay = civil(day);
  const plan = {supplierId, agreementId: SUPPLIERS[supplierId].agreementId, plannedDay, closedAt: null};
  const rows = Object.fromEntries(ROW_ORDER.map((row, i) => [row, {
    row, flag: ['Civil', 'Workforce'].includes(row) ? 'Watch' : 'Mandatory',
    status: row !== blockerRow ? 'Ready' : critical ? 'Not Ready' : 'In progress',
    quality: 'Current', source: feeds[i], sourceAt: scoreTime, ingestedAt: null,
    ownerId, observations: [], note: null, detail: row === blockerRow ? blocker : null,
  }]));
  const limitation = blockerRow ? `${blocker}. The assessment cannot establish when this prerequisite will clear.`
    : `The evidence at ${name} supports readiness, but does not authorize dispatch.`;
  const impact = critical ? `Hold the ${name} crew until ${blockerRow.toLowerCase()} is confirmed.`
    : waiting ? 'Ask the program manager to approve the supplier change and move the visit to 22 May.'
    : blockerRow ? `Confirm ${blockerRow.toLowerCase()} evidence before the planned visit.` : 'Check the crew plan before dispatch.';
  const assessment = {siteId: id, model: MODEL, plannedDay, planRev: 0, evidenceRev: 0, probability, confidence,
    scoredAt: scoreTime, correlationId: `corr_${id}_seed`, snapshotId: `snap_${id}_seed`, limitation, factorNote: null,
    contributions: [blockerRow ? {label: blocker, points: critical ? 42 : 24, targetKind: 'row', targetRef: blockerRow}
      : {label: 'Current permit evidence', points: -18, targetKind: 'row', targetRef: 'Permit'}]};
  const proposal = {id: `rec_${id}`, kind: waiting ? 'resequence' : critical ? 'hold' : blockerRow ? 'refresh' : 'follow_up',
    state: waiting ? 'Pending approval' : 'Recommended', planRev: 0, ownerId, dueDay: plannedDay, dueTime: null,
    targetRow: blockerRow, window: null, impact, rationaleSummary: limitation, alternatives: [],
    payload: waiting ? {kind: 'resequence', supplierId: 'harbor', agreementId: SUPPLIERS.harbor.agreementId, plannedDay: civil('05-22')}
      : critical ? {kind: 'hold'} : null};
  return {id, name, neighborhood, x: 10 + index * 7, y: 20 + index * 5, plan, planRev: 0, evidenceRev: 0, rev: 0,
    lifecycle: 'open', disposition: waiting ? 'Pending approval' : critical ? 'Hold' : blockerRow ? 'Needs review' : 'Ready',
    risk: critical ? 'Red' : probability < 80 ? 'Amber' : 'Green', blocker, holdActive: critical,
    ownerId, crewRequired: true, rows, notes: [], assessment, scoreState: 'current', proposal, decisions: [], executions: []};
}

/** Build a fresh full workshop record; the West branch returns the unmodified adopted baseline. */
export function makeProgramBoard(programId = DEFAULT_PROGRAM) {
  if (programId === DEFAULT_PROGRAM) return makeBaseline();
  const meta = PROGRAMS[programId];
  const config = configurations[programId];
  if (!Object.hasOwn(configurations, programId)) throw new Error('Unknown program.');
  // Earlier operating updates remain separate from the shared morning replay clock.
  const updatedAt = civil(config.update);
  const scoredAt = programId === 'east-bay' ? updatedAt : civil('05-12 09:34');
  const baseline = makeBaseline();
  const records = config.sites.map((entry, index) => buildSite(meta, scoredAt, entry, index));
  const sites = Object.fromEntries(records.map(site => [site.id, site]));
  const focus = sites[meta.focus];
  const failures = programId === 'south-shore' ? [{id: 'fail_south_7101', siteId: focus.id, name: focus.name,
    whenDay: civil('05-08'), whenAt: civil('05-08 07:30'), outcome: 'Crew turned away at the closed access gate.', state: 'Open',
    detail: 'Keep the visit on hold until the access permit is reinstated.', reattemptDay: focus.plan.plannedDay}] : [];
  const crew = records.map((site, index) => ({id: `crew_${site.id}`, rev: 0, siteId: site.id,
    leadId: [PERSON.helen, PERSON.marco, PERSON.luis][index % 3], size: 3 + index % 2, depot: config.depot,
    shiftDay: site.plan.plannedDay, shiftAt: `${site.plan.plannedDay}T07:00:00`, state: site.disposition}));
  const design = (config.design ?? []).map(([number, name, neighborhood, day, probability, blocker, owner]) => ({
    siteId: `NRO-${meta.letter}-${number}`, name, neighborhood, plannedDay: civil(day), probability, blocker,
    ownerId: PERSON[owner], state: 'Design', targetMonth: civil(day).slice(0, 7),
  }));
  const notices = records.filter(site => site.blocker !== 'None').map((site, index) => ({id: `notice_${site.id}`,
    siteId: site.id, text: `${site.name} · ${site.blocker}`, unread: true, seedSeq: index + 1}));
  const morning = [{id: `feed_${focus.id}`, seq: 1, siteId: focus.id, siteName: focus.name, at: updatedAt,
    actorLabel: meta.lead, verb: failures.length ? 'Disposition' : 'Evidence updated', detail: meta.decision}];
  const sources = Object.fromEntries(Object.keys(baseline.program.sources).map(sourceId => [sourceId,
    {sourceId, lastSyncAt: sourceId === 'Assessment' ? scoredAt : civil('05-12 09:34'), state: 'Up', detail: `${meta.region} workshop feed.`}]));
  const trend = config.trend.map((greenShare, index) => ({day: civil(index < 2 ? `04-${29 + index}`
    : `05-${String(index - 1).padStart(2, '0')}`), greenShare}));
  const {siteId, model, correlationId, snapshotId} = focus.assessment;
  const snapshots = Object.fromEntries(records.map(site => [site.assessment.snapshotId, captureSnapshot(site, site.assessment.snapshotId)]));
  return {...baseline, sites, uploads: {}, audit: {...baseline.audit, snapshots, events: [], nextSeq: 1},
    program: {name: meta.name, cluster: meta.name, region: meta.region, quarter: meta.quarter,
      openedDay: civil(config.update.split(' ')[0]), leadId: PERSON[config.lead], managerId: PERSON.priya, suppliers: SUPPLIERS,
      crew, failures, design, notices, morning, trend, sources, eco: {},
      visitsAtStake: records.filter(site => site.holdActive && site.plan.plannedDay <= civil('05-18')).map(site => site.id),
      lastScore: {siteId, model, scoredAt, correlationId, snapshotId}}};
}
