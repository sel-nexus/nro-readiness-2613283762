/** Project portfolio triage and the unchanged program history from committed board records. */
import {DIRECTORY} from '../data/people.js';
import {BOARD_AT} from '../data/register.js';
import {deriveReadiness} from './readiness.js';

export const FILTERS = Object.freeze(['All', 'Green', 'Amber', 'Red', 'Hold', 'Pending approval', 'Dispatched', 'On air', 'Data exception']);
export const RISK_RANK = Object.freeze({Red: 0, Amber: 1, Green: 2});
export const NO_MATCH = 'No site matches that name in West Metro Cluster 4.';
export const RISK_STYLE = Object.freeze({
  Green: {badge: 'risk-green', ink: 'text-teal-ink', row: 'bg-green-wash/30 hover:!bg-green-wash', fill: 'bg-teal'},
  Amber: {badge: 'risk-amber', ink: 'text-amber', row: 'bg-amber-wash/30 hover:!bg-amber-wash', fill: 'bg-amber'},
  Red: {badge: 'risk-red', ink: 'text-red', row: 'bg-red-wash/30 hover:!bg-red-wash', fill: 'bg-red'},
});
const dateFormat = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
const monthFormat = new Intl.DateTimeFormat('en-GB', {month: 'short', year: 'numeric', timeZone: 'UTC'});
const relativeFormat = new Intl.RelativeTimeFormat('en', {numeric: 'auto'});

/** Build the exact route shared by row, pin and shell links. */
export const sitePath = id => `/sites/${id}`;

/** Label civil timestamps without shifting them to a browser's timezone. */
export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const day = dateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
  return withTime && value.length > 10 ? `${day} ${value.slice(11, 16)}` : day;
}

/** Label a queue month without creating a planned day. */
export const formatMonth = value => monthFormat.format(new Date(`${value}-01T00:00:00Z`));

/** Describe planned time relative to the fixed board day, not today's real date. */
export const relativeDay = day => relativeFormat.format((Date.parse(day) - Date.parse(BOARD_AT.slice(0, 10))) / 86400000, 'day');

/** Resolve a next owner or crew lead without exposing private account fields. */
export const personName = (board, id) => board.users[id]?.name ?? DIRECTORY[id]?.name ?? '—';

/** Rank exact, prefix and substring matches over released names and identifiers. */
export function searchSites(sites, query = '') {
  const term = query.trim().toLowerCase();
  const rank = site => Math.min(...[site.id, site.name].map(value => {
    const field = value.toLowerCase();
    return field === term ? 0 : field.startsWith(term) ? 1 : field.includes(term) ? 2 : 3;
  }));
  return Object.values(sites).map(site => ({site, rank: rank(site)})).filter(entry => entry.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.site.id.localeCompare(b.site.id)).map(entry => entry.site);
}

/** Identify active categories independently of the wording of the disposition. */
function matchesChip(site, chip) {
  if (Object.hasOwn(RISK_RANK, chip)) return site.risk === chip;
  if (chip === 'Hold') return site.holdActive;
  if (chip === 'Pending approval') return site.proposal?.state === 'Pending approval';
  if (chip === 'Dispatched') return site.lifecycle === 'dispatched';
  if (chip === 'On air') return site.lifecycle === 'on_air';
  if (chip === 'Data exception') return site.lifecycle !== 'on_air' && Object.values(site.rows).some(row => row.quality !== 'Current');
  return chip === 'All';
}

/** Keep missing values last in either direction. */
function compareNullable(a, b, direction = 1) {
  if (a == null || b == null) return Number(a == null) - Number(b == null);
  return direction * (a < b ? -1 : a > b ? 1 : 0);
}

/** Sort by operator-requested column while preserving closed sites and stable ties. */
export function compareSites(a, b, sort) {
  const closesLast = Number(a.lifecycle === 'on_air') - Number(b.lifecycle === 'on_air');
  if (closesLast) return closesLast;
  const fallback = () => RISK_RANK[a.risk] - RISK_RANK[b.risk]
    || compareNullable(a.plan.plannedDay, b.plan.plannedDay) || a.id.localeCompare(b.id);
  const direction = sort?.direction === 'descending' ? -1 : 1;
  if (sort?.key === 'planned') return compareNullable(a.plan.plannedDay, b.plan.plannedDay, direction) || fallback();
  if (sort?.key === 'readiness') return compareNullable(a.assessment?.probability, b.assessment?.probability, direction) || fallback();
  if (sort?.key === 'risk') return direction * (RISK_RANK[a.risk] - RISK_RANK[b.risk]) || fallback();
  return fallback();
}

/** Project exception groups from field state without interpreting disputed inputs as verified. */
export function exceptionsFor(sites) {
  const active = Object.values(sites).filter(site => site.lifecycle === 'open');
  const groups = [
    ['power', 'power Not Ready', site => site.rows.Power.status === 'Not Ready' && site.rows.Power.quality === 'Current'],
    ['stale', 'stale evidence', site => Object.values(site.rows).some(row => row.flag === 'Mandatory' && row.quality === 'Stale')],
    ['conflict', 'source conflict', site => Object.values(site.rows).some(row => row.quality === 'Conflicting')],
    ['decision', 'decision waiting', site => site.proposal?.state === 'Pending approval'],
  ];
  return groups.map(([id, label, match]) => ({id, label, sites: active.filter(match).sort((a, b) => a.id.localeCompare(b.id))}));
}

/** Keep full-board totals separate from the filtered register and map. */
export function selectPortfolio(board, {query = '', chip = 'All', sort, exception} = {}) {
  const sites = Object.fromEntries(Object.entries(board.sites).map(([id, site]) => {
    const {risk, disposition, current, quality} = deriveReadiness(site, BOARD_AT, board.faults, board.audit.snapshots[site.assessment?.snapshotId]);
    const assessment = site.lifecycle === 'open' && !current ? null : site.assessment;
    const changedQuality = Object.keys(quality).filter(row => site.rows[row].quality !== quality[row]);
    const rows = changedQuality.length ? {...site.rows} : site.rows;
    for (const key of changedQuality) rows[key] = {...rows[key], quality: quality[key]};
    return [id, risk === site.risk && disposition === site.disposition && assessment === site.assessment && rows === site.rows
      ? site : {...site, risk, disposition, assessment, rows}];
  }));
  const full = Object.values(sites);
  const risk = {Green: 0, Amber: 0, Red: 0};
  full.forEach(site => { risk[site.risk] += 1; });
  const exceptions = exceptionsFor(sites);
  const group = exceptions.find(entry => entry.id === exception);
  const matching = searchSites(sites, query).filter(site => matchesChip(site, chip) && (!group || group.sites.includes(site)));
  const visible = !sort && query.trim() ? matching : matching.sort((a, b) => compareSites(a, b, sort));
  return {visible, exceptions, total: full.length, risk, atRisk: risk.Amber + risk.Red,
    hold: full.filter(site => site.holdActive).length, dispatched: full.filter(site => site.lifecycle === 'dispatched').length,
    onAir: full.filter(site => site.lifecycle === 'on_air' && site.plan.closedAt?.startsWith(BOARD_AT.slice(0, 7))),
    visitsAtStake: board.program.visitsAtStake.map(id => board.sites[id]), failed: board.program.failures.length,
    failedOpen: board.program.failures.filter(entry => entry.state === 'Open').length};
}

/** Keep score history separate from the deliberately curated morning feed. */
export function morningActivity(program) {
  return [...program.morning].sort((a, b) => b.at.localeCompare(a.at) || a.seq - b.seq).slice(0, 8);
}

/** Show all notices without marking them read or mutating their order in storage. */
export function orderedNotices(notices) {
  return [...notices].sort((a, b) => Number(b.unread) - Number(a.unread) || a.seedSeq - b.seedSeq);
}

/** Project the four shell sources and fixed-clock sync age. */
export function sourceSummary(board) {
  const items = ['DPAM', 'POS', 'DDL', 'ECO'].map(id => board.program.sources[id]);
  const newest = items.map(item => item.lastSyncAt).filter(Boolean).sort().at(-1);
  const age = newest ? Math.max(0, Math.floor((Date.parse(`${BOARD_AT}Z`) - Date.parse(`${newest}Z`)) / 60000)) : null;
  return {items, age};
}
