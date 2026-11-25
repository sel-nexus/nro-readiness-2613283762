/** Define released sites, ordered evidence and the frozen assessment input copy. */
import {freezeTree, PERSON} from './people.js';

export const MODEL = 'nro-readiness-sim 1.4.2';
export const MORNING_SCORE_AT = '2026-05-12T09:34:00';
export const BOARD_AT = '2026-05-12T09:40:00';

/** Expand a seed month/day or civil timestamp without timezone conversion. */
export function civil(value) {
  if (value == null) return null;
  const [day, time] = value.split(' ');
  return `2026-${day}${time ? `T${time}:00` : ''}`;
}

export const SUPPLIERS = freezeTree({
  northwind: {id: 'northwind', name: 'Northwind Power', agreementId: 'AGR-NW-2291'},
  civic: {id: 'civic', name: 'Civic Civil', agreementId: 'AGR-CC-1844'},
  brightline: {id: 'brightline', name: 'Brightline Materials', agreementId: 'AGR-BL-3308'},
  harbor: {id: 'harbor', name: 'Harbor Tower Co.', agreementId: 'AGR-HT-0902'},
  fieldcrew: {id: 'fieldcrew', name: 'Fieldcrew West', agreementId: 'AGR-FC-4410'},
});

const released = [
  [1891, 'Point Richmond', 'Richmond, Point Richmond', 18, 22, '05-26', 'northwind', 29, 78, 'Red', 'Hold', 'Power · Not Ready', 'ruth'],
  [1842, 'Harbor Point', 'Oakland, Harbor Point', 48, 78, '05-18', 'northwind', 34, 86, 'Red', 'Hold', 'Power · Not Ready', 'ruth'],
  [1860, 'Hillcrest', 'Berkeley, Hillcrest', 28, 18, '05-22', 'fieldcrew', 44, 48, 'Red', 'Needs review', 'Workforce · Not Ready', 'andre'],
  [1866, 'Portside', 'Oakland, Portside', 42, 84, '05-15', 'northwind', 58, 84, 'Amber', 'Pending approval', 'Power window · supplier change', 'priya'],
  [1855, 'Market DAS', 'Oakland, Market', 46, 58, '05-19', 'brightline', 63, 61, 'Amber', 'Needs review', 'Material · conflict', 'omar'],
  [1838, 'Dimond', 'Oakland, Dimond', 70, 62, '05-23', 'brightline', 68, 70, 'Amber', 'Needs review', 'Material · stale', 'omar'],
  [1851, 'Lakeside', 'Alameda, Lakeside', 74, 78, '05-20', 'harbor', 71, 54, 'Amber', 'Needs review', 'Permit · stale', 'denise'],
  [1872, 'East Yard', 'Emeryville, East Yard', 58, 42, '05-25', 'civic', null, 62, 'Amber', 'Needs review', 'Transmission · missing', 'noah'],
  [1884, 'El Cerrito', 'El Cerrito, El Cerrito', 22, 34, '05-27', 'civic', 84, 80, 'Green', 'Ready', 'None', 'elena'],
  [1834, 'Rockridge', 'Oakland, Rockridge', 36, 30, '05-14', 'brightline', 86, 81, 'Green', 'Ready for dispatch', 'None', 'andre'],
  [1878, 'North Gate', 'Richmond, North Gate', 24, 28, '05-21', 'brightline', 88, 83, 'Green', 'Ready', 'Civil · in progress', 'irene'],
  [1822, 'Jack London', 'Oakland, Jack London', 40, 72, '05-11', 'civic', 90, 88, 'Green', 'Dispatched', 'None', 'helen'],
  [1828, 'Piedmont Ave', 'Oakland, Piedmont Ave', 52, 40, '05-12', 'brightline', 91, 87, 'Green', 'Dispatched', 'None', 'marco'],
  [1847, 'Civic Center', 'Oakland, Civic Center', 44, 50, '05-16', 'civic', 92, 90, 'Green', 'Ready for dispatch', 'None', 'luis'],
  [1810, 'Fruitvale', 'Oakland, Fruitvale', 62, 70, null, 'harbor', null, 94, 'Green', 'On air', 'None', 'elena', '05-04 16:45'],
  [1816, 'Temescal', 'Oakland, Temescal', 38, 36, null, 'civic', null, 93, 'Green', 'On air', 'None', 'elena', '05-06 14:20'],
];

const defaults = [
  ['Permit', 'Mandatory', 'City portal', 'denise', '05-05 11:20'],
  ['Civil', 'Watch', 'DPAM', 'irene', '05-08 15:05'],
  ['Power', 'Mandatory', 'Northwind Power feed', 'ruth', '05-10 09:40'],
  ['Transmission', 'Mandatory', 'DDL', 'noah', '05-09 13:10'],
  ['Material', 'Mandatory', 'Brightline Materials', 'omar', '05-11 08:50'],
  ['Workforce', 'Watch', 'Fieldcrew West', 'andre', '05-11 16:30'],
];
export const ROW_ORDER = Object.freeze(defaults.map(([row]) => row));

const times = {
  1842: ['05-07 10:15', '05-09 14:00', '05-11 16:10', '05-08 13:10', '05-10 08:50', '05-11 16:30'],
  1891: ['05-01 09:40', '05-09 11:15', '05-11 19:05', '05-08 10:20', '05-11 08:00', '05-11 12:10'],
  1810: ['04-24 10:00', '04-27 14:20', '04-29 09:00', '04-30 11:40', '05-02 08:30', '05-03 16:00'],
  1816: ['04-28 09:30', '05-01 13:00', '05-03 10:15', '05-02 15:45', '05-04 11:20', '05-05 17:10'],
  1822: ['05-04 11:00', '05-06 09:40', '05-08 14:05', '05-07 16:30', '05-10 08:15', '05-11 06:40'],
  1828: ['05-05 10:20', '05-07 15:00', '05-09 11:30', '05-08 09:50', '05-11 13:10', '05-12 06:10'],
  1847: ['05-06 09:00', '05-08 14:30', '05-10 10:10', '05-09 11:00', '05-11 08:40', '05-11 15:05'],
};
const overrides = {
  1842: {Permit: {ownerId: PERSON.elena}, Power: {status: 'Not Ready'}},
  1891: {Power: {status: 'Not Ready'}},
  1860: {Workforce: {status: 'Not Ready', quality: 'Stale', sourceAt: civil('05-07 18:00')}},
  1866: {Power: {status: 'In progress', sourceAt: civil('05-11 17:20')}, Workforce: {sourceAt: civil('05-11 07:00')}},
  1855: {Material: {
    status: 'Not Ready', quality: 'Conflicting', sourceAt: civil('05-11 16:40'), source: 'DPAM and DDL',
    observations: [
      {source: 'DPAM', sourceAt: civil('05-11 10:15'), ingestedAt: null, status: 'Ready'},
      {source: 'DDL', sourceAt: civil('05-11 16:40'), ingestedAt: null, status: 'Not Ready'},
    ],
    detail: 'DPAM Ready 11 May 2026 10:15. DDL Not Ready 11 May 2026 16:40. Antenna kit is short on the DDL count.',
  }},
  1838: {Material: {quality: 'Stale', sourceAt: civil('05-08 08:00')}},
  1851: {Permit: {quality: 'Stale', sourceAt: civil('04-22 14:05')}},
  1872: {Transmission: {status: 'Unavailable', quality: 'Missing', sourceAt: null}},
  1878: {Civil: {status: 'In progress', sourceAt: civil('05-10 16:45')}, Permit: {sourceAt: civil('05-04 13:20')}},
  1834: {Material: {sourceAt: civil('05-12 07:10')}, Workforce: {sourceAt: civil('05-11 18:00')}},
  1884: {Permit: {sourceAt: civil('05-03 14:15')}},
};

// Each signed factor optionally links to its input row or document.
const explanation = {
  1842: [[['Power Not Ready', 46, 'Power'], ['Planned date inside 6 days', 22, 'plan'], ['Permit current', -12, 'Permit'], ['Material on site', -8, 'Material']], 'Power status is a single supplier update. The score does not estimate utility duration past Ruth’s window.', 'Hold the 18 May crew and confirm the Northwind window before 13 May 15:00.', '05-13 15:00', 'Power'],
  1891: [[['Failed visit on 8 May', 40, 'doc_1891_fail'], ['Power still Not Ready', 38, 'Power'], ['Material refreshed', -10, 'Material']], 'The 8 May abort is history. It is not a prediction that the 26 May reattempt will fail.', 'Keep the crew on hold. Ruth confirms power before any new dispatch. Reattempt stays 26 May.', '05-18', 'Power'],
  1860: [[['Workforce unconfirmed', 44, 'Workforce'], ['Confidence under 60%', 20], ['Permit current', -8, 'Permit']], 'Fieldcrew West has not named a crew. The score will not invent one.', 'Andre confirms a crew of 4, or the 22 May shift moves. Dispatch stays disabled.', '05-14', 'Workforce'],
  1866: [[['Power still in progress', 28, 'Power'], ['Baseline date inside 3 days', 24, 'plan'], ['Other prerequisites current', -14]], 'A supplier change is a recommendation. It is not applied until Priya approves it.', 'Ask Priya to move the pad from Northwind Power to Civic Civil and the date from 15 May to 19 May.', '05-12', 'Power'],
  1855: [[['Sources disagree on material', 30, 'Material'], ['DDL short-kit', 18, 'Material'], ['Permit current', -8, 'Permit']], 'The score does not choose DPAM or DDL. Omar resolves the count.', 'Omar reconciles the antenna kit with DDL and DPAM before 14 May.', '05-14', 'Material'],
  1838: [[['Material evidence 4 days old', 22, 'Material'], ['Threshold is 3 days', 10, 'Material'], ['Power current', -8, 'Power']], 'Stale material lowers confidence. It does not mean the kit is missing.', 'Omar posts a fresh material count.', '05-13', 'Material'],
  1851: [[['Permit 20 days old', 26, 'Permit'], ['Threshold is 14 days', 12, 'Permit'], ['Power current', -8, 'Power']], 'No inspection is inferred from an old permit file.', 'Denise gets a current city-portal inspection on file.', '05-15', 'Permit'],
  1872: [[['Transmission timestamp missing', 34, 'Transmission'], ['Other prerequisites current', -12]], 'Missing transmission is left Unavailable. The model does not score a guess.', 'Noah attaches the transmission evidence, then Elena runs assessment again.', '05-16', 'Transmission'],
  1884: [[['All mandatory prerequisites current', -18], ['Date inside horizon', 8, 'plan']], 'Early green is not a dispatch order. The date is still 27 May.', 'Elena watches the board. No action this week.', '05-20', null, 'No blocker.'],
  1834: [[['Material landed this morning', -16, 'Material'], ['Workforce named', -10, 'Workforce'], ['Date in 2 days', 12, 'plan']], 'Ready for dispatch still needs Andre to send the crew.', 'Dispatch Luis Ortega, crew of 4, 14 May 07:00, if the morning check stays green.', '05-13'],
  1878: [[['Civil in progress, not mandatory', 8, 'Civil'], ['Mandatory prerequisites current', -16]], 'Civil can slip without turning the site red. It is still visible.', 'Irene updates civil by 18 May. No hold.', '05-18', 'Civil'],
  1822: [[['Crew on site since 11 May', -20, 'Workforce'], ['Access confirmed', -8, 'Civil']], 'The install is underway. This is no longer a go or no-go score.', 'Helen closes the install checklist today.', '05-12'],
  1828: [[['Crew dispatched 07:00', -18, 'Workforce'], ['Evidence current', -10]], 'Same as Jack London. The useful fact is that the crew is out.', 'Marco confirms arrival before 10:00.', '05-12'],
  1847: [[['All mandatory evidence current', -22], ['Approval already on file', -8, 'approval']], 'The 16 May dispatch was approved on 11 May. A new supplier change would need a new approval.', 'Andre dispatches Luis Ortega, crew of 4, 16 May 07:00.', '05-15'],
  1810: [[], 'This site is on air. The figure is the score at close.', 'None. Site is on air.', null, null, 'Closed on evidence that was current on 4 May.'],
  1816: [[], 'This site is on air. The figure is the score at close.', 'None. Site is on air.', null, null, 'Closed on evidence that was current on 6 May.'],
};

/** Build the intervention and scope without applying the proposed plan change. */
function proposalFor(number, ownerId, action, limitation, due, targetRow = null) {
  const [day, dueTime = null] = due?.split(' ') ?? [];
  const portside = number === 1866;
  const harbor = number === 1842;
  return {
    id: `rec_${number}`, kind: portside ? 'resequence' : [1842, 1891].includes(number) ? 'hold' : targetRow ? 'refresh' : 'follow_up',
    state: portside ? 'Pending approval' : due ? 'Recommended' : 'Closed', planRev: 0,
    ownerId, dueDay: civil(day), dueTime, targetRow, window: harbor ? '15 May if the cutover holds' : null,
    impact: action, rationaleSummary: limitation,
    payload: portside ? {kind: 'resequence', supplierId: 'civic', agreementId: 'AGR-CC-1844', plannedDay: civil('05-19')} : harbor ? {kind: 'hold'} : null,
    alternatives: harbor ? [
      {id: 'opt_1842_north_gate', label: 'Resequence now to North Gate’s spare crew on 21 May', payload: {kind: 'resequence', plannedDay: civil('05-21'), assignmentId: 'crew_1842', crewLeadId: PERSON.luis, crewSize: 4, shiftAt: civil('05-21 07:00')}},
      {id: 'opt_1842_escalate', label: 'Escalate to the program manager for a supplier change', payload: null},
    ] : [],
  };
}

export const REGISTER = freezeTree(Object.fromEntries(released.map(
  ([number, name, neighborhood, x, y, day, supplierId, probability, confidence, risk, disposition, blocker, owner, closed]) => {
    const id = `NRO-W-${number}`;
    const [factors, limitation, action, due, targetRow, factorNote = null] = explanation[number];
    const plan = {supplierId, agreementId: SUPPLIERS[supplierId].agreementId, plannedDay: civil(day), closedAt: civil(closed)};
    const lifecycle = closed ? 'on_air' : disposition === 'Dispatched' ? 'dispatched' : 'open';
    const rows = Object.fromEntries(defaults.map(([row, flag, source, rowOwner, time], index) => [row, {
      row, flag, status: 'Ready', quality: 'Current', source, sourceAt: civil(times[number]?.[index] ?? time),
      ingestedAt: null, ownerId: PERSON[rowOwner], observations: [], note: null, detail: null,
      ...overrides[number]?.[row],
    }]));
    const contributions = factors.map(([label, points, ref]) => ({label, points,
      targetKind: ROW_ORDER.includes(ref) ? 'row' : ref?.startsWith('doc_') ? 'document' : ref ?? null,
      targetRef: ref === 'approval' ? 'approval_1847_0511' : ref ?? null,
    }));
    const assessment = {siteId: id, model: MODEL, plannedDay: plan.plannedDay, planRev: 0, evidenceRev: 0,
      probability, confidence, scoredAt: MORNING_SCORE_AT, correlationId: `corr_${number}_a`, snapshotId: `snap_${number}_0934`,
      contributions, limitation, factorNote};
    const ownerId = PERSON[owner];
    return [id, {id, name, neighborhood, x, y, plan, planRev: 0, evidenceRev: 0, rev: 0,
      lifecycle, disposition, risk, blocker, holdActive: disposition === 'Hold', ownerId, crewRequired: !closed,
      rows, notes: [], assessment, scoreState: closed ? 'closed' : probability === null ? 'unavailable' : 'current',
      proposal: proposalFor(number, ownerId, action, limitation, due, targetRow), decisions: [], executions: []}];
  },
)));
