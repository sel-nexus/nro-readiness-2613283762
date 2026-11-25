/** Verify released-site projections, fixed-clock labels and independent program records. */
import {describe, expect, it} from 'vitest';
import {makeBaseline} from '../src/data/baseline.js';
import {exceptionsFor, FILTERS, formatDate, formatMonth, morningActivity, orderedNotices, personName, relativeDay, searchSites, selectPortfolio, sourceSummary} from '../src/utils/portfolio.js';

describe('portfolio triage', () => {
  it('reconciles the full board and keeps design and off-board history out of released rows', () => {
    const board = makeBaseline();
    const model = selectPortfolio(board);
    expect(model).toMatchObject({total: 16, risk: {Green: 8, Amber: 5, Red: 3}, atRisk: 8, hold: 2, dispatched: 2, failed: 3, failedOpen: 1});
    expect(model.visible.slice(0, 3).map(site => site.name)).toEqual(['Harbor Point', 'Hillcrest', 'Point Richmond']);
    expect(model.onAir.map(site => site.name)).toEqual(['Fruitvale', 'Temescal']);
    expect(model.visitsAtStake.map(site => site.name)).toEqual(['Harbor Point', 'Hillcrest']);
    expect(model.visible.slice(-2).map(site => site.name)).toEqual(['Fruitvale', 'Temescal']);
    expect(board.program.design).toHaveLength(6);
    expect(board.program.crew).toHaveLength(10);
    expect(board.program.crew[2]).toMatchObject({siteId: null, shiftDay: '2026-05-13'});
  });

  it('matches only released ID and name, ranking exact before prefix before substring', () => {
    const {sites} = makeBaseline();
    expect(searchSites(sites, '  hARBor ').map(site => site.name)).toEqual(['Harbor Point']);
    expect(searchSites(sites, '1842').map(site => site.name)).toEqual(['Harbor Point']);
    expect(searchSites(sites, 'point').map(site => site.name)).toEqual(['Point Richmond', 'Harbor Point']);
    for (const nonMatch of ['Oakland', 'Albany Hill', '1766']) expect(searchSites(sites, nonMatch)).toEqual([]);
    const rows = [{id: '1', name: 'A point'}, {id: '2', name: 'Point'}, {id: '3', name: 'Point one'}, {id: '4', name: 'Point two'}];
    expect(searchSites(rows, 'point').map(site => site.id)).toEqual(['2', '3', '4', '1']);
  });

  it('applies one chip with search while keeping KPIs and fixed designations unchanged', () => {
    const board = makeBaseline();
    expect(FILTERS.map(chip => selectPortfolio(board, {chip}).visible.length)).toEqual([16, 8, 5, 3, 2, 1, 2, 2, 5]);
    expect(selectPortfolio(board, {chip: 'Hold', query: 'harbor'}).visible.map(site => site.name)).toEqual(['Harbor Point']);
    expect(selectPortfolio(board, {chip: 'Green', query: 'harbor'})).toMatchObject({visible: [], atRisk: 8, total: 16});
    const harbor = board.sites['NRO-W-1842'];
    harbor.disposition = 'Approved — hold';
    expect(selectPortfolio(board, {chip: 'Hold'}).visible).toContain(harbor);
  });

  it('derives active exception membership and clears it when verified evidence changes', () => {
    const board = makeBaseline();
    const groups = exceptionsFor(board.sites);
    expect(groups.map(group => group.sites.map(site => site.name))).toEqual([['Harbor Point', 'Point Richmond'], ['Dimond', 'Lakeside'], ['Market DAS'], ['Portside']]);
    expect(selectPortfolio(board, {exception: 'conflict'}).visible.map(site => site.name)).toEqual(['Market DAS']);
    board.sites['NRO-W-1855'].rows.Material.quality = 'Current';
    expect(selectPortfolio(board, {exception: 'conflict'}).visible).toEqual([]);
  });

  it('sorts requested columns without changing closed-row or missing-score placement', () => {
    const board = makeBaseline();
    for (const [key, direction, first] of [['planned', 'ascending', 'Jack London'], ['planned', 'descending', 'El Cerrito'], ['readiness', 'ascending', 'Point Richmond'], ['readiness', 'descending', 'Civic Center'], ['risk', 'ascending', 'Harbor Point'], ['risk', 'descending', 'Jack London']]) {
      const names = selectPortfolio(board, {sort: {key, direction}}).visible.map(site => site.name);
      expect(names[0]).toBe(first);
      expect(names.slice(-2)).toEqual(['Fruitvale', 'Temescal']);
      if (key === 'readiness') expect(names.at(-3)).toBe('East Yard');
    }
  });

  it('uses program activity, notice order and civil labels rather than audit history or wall time', () => {
    const board = makeBaseline();
    expect(morningActivity(board.program)).toHaveLength(8);
    expect(morningActivity(board.program).slice(0, 3).map(entry => entry.verb)).toEqual(['Disposition', 'Scored', 'Recommended']);
    const notices = orderedNotices([...board.program.notices].reverse());
    expect(notices).toEqual(board.program.notices);
    expect(notices.filter(notice => notice.unread)).toHaveLength(8);
    expect(sourceSummary(board)).toMatchObject({age: 6, items: [{sourceId: 'DPAM'}, {sourceId: 'POS'}, {sourceId: 'DDL'}, {sourceId: 'ECO'}]});
    expect(formatDate('2026-05-12T09:34:00', true)).toBe('12 May 2026 09:34');
    expect(formatDate(null)).toBe('—');
    expect(formatMonth('2026-06')).toBe('Jun 2026');
    expect(relativeDay('2026-05-18')).toBe('in 6 days');
    expect(personName(board, 'NRO-E-22881')).toBe('Luis Ortega');
    expect(personName(board, null)).toBe('—');
  });
});
