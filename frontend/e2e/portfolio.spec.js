/** Exercise released-site triage and navigation on desktop and mobile. */
import {expect, test} from '@playwright/test';

const pageErrors = new WeakMap();
test.beforeEach(async ({page}) => {
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  pageErrors.set(page, errors);
});

test.afterEach(async ({page}) => {
  expect(pageErrors.get(page), 'Browser console errors and uncaught exceptions').toEqual([]);
});

/** Open the requested scope through the Programs page. */
async function openWest(page) {
  await page.goto('/login');
  await page.getByRole('button', {name: 'Continue as Marcus Hale'}).click();
  await page.getByRole('link', {name: 'Open West Metro Cluster 4'}).click();
  await expect(page).toHaveURL('/board');
}

test('orders the five Board blocks and makes counts, exceptions, and owners actionable', async ({page}) => {
  await openWest(page);
  const nav = page.getByRole('navigation', {name: 'Program'});
  const boardNav = nav.getByRole('link', {name: 'Board', exact: true});
  await expect(boardNav).toHaveCSS('background-color', 'rgb(0, 130, 240)');
  await expect(boardNav).toHaveCSS('text-decoration-line', 'none');
  const main = page.getByRole('main');
  const blocks = main.locator('[aria-label="Program Board"] > section');
  await expect(blocks).toHaveCount(5);
  await expect(blocks.nth(0)).toContainText('Harbor Point is on hold. Power is not ready.');
  await expect(blocks.nth(0).getByRole('link', {name: 'Review Harbor Point'})).toHaveAttribute('href', '/sites/NRO-W-1842');
  await expect(blocks.nth(0).getByRole('link')).toHaveCount(1);
  const totals = blocks.nth(1);
  await expect(totals.getByRole('link')).toHaveCount(4);
  for (const label of [/Sites at risk\s*8/, /Visits at stake this week\s*2/, /Failed visits this quarter\s*3/, /On air this month\s*2/]) {
    await expect(totals.getByRole('link', {name: label})).toBeVisible();
  }
  const readiness = blocks.nth(2);
  for (const label of ['Good 8', 'Needs Attention 5', 'Critical 3']) await expect(readiness.getByText(label, {exact: true})).toBeVisible();
  await expect(readiness.getByRole('heading', {name: '14-day readiness trend'})).toBeVisible();
  const trend = readiness.getByRole('img', {name: /^14-day Good share trend:/});
  await expect(trend).toHaveAttribute('aria-label', /29 Apr 2026 71%.*12 May 2026 50%/);
  expect((await trend.getAttribute('aria-label')).match(/%/g)).toHaveLength(14);
  const exceptions = blocks.nth(3);
  for (const label of ['2 power Not Ready', '2 stale evidence', '1 source conflict', '1 decision waiting']) {
    await expect(exceptions.getByRole('link', {name: label, exact: true})).toBeVisible();
  }
  for (const [name, siteId] of [['Harbor Point', '1842'], ['Point Richmond', '1891'], ['Dimond', '1838'], ['Lakeside', '1851'], ['Market DAS', '1855'], ['Portside', '1866']]) {
    const link = exceptions.getByRole('link', {name, exact: true});
    await expect(link).toHaveAttribute('href', `/sites/NRO-W-${siteId}`);
    await expect(link).toHaveCSS('text-decoration-line', 'none');
  }
  const table = blocks.nth(4).getByRole('table', {name: 'Site readiness register'});
  await expect(table.getByRole('row')).toHaveCount(17);
  await expect(main.getByRole('heading', {name: /Morning log|Crews this week|Planned visits|Design queue|Cluster schematic|Normal workshop focus/})).toHaveCount(0);
  await expect(main.getByRole('button', {name: 'How to read this'})).toHaveCount(0);
  await expect(main.getByText('Mandela Parkway', {exact: true})).toHaveCount(0);

  await totals.getByRole('link', {name: /^Sites at risk/}).click();
  await expect(table.getByRole('row')).toHaveCount(9);
  await totals.getByRole('link', {name: /^On air this month/}).click();
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('row').last()).toContainText('Temescal');
  await main.getByRole('link', {name: 'Clear filters'}).click();
  const harbor = table.getByRole('row').filter({has: table.getByRole('link', {name: 'Harbor Point', exact: true})});
  await expect(harbor.getByRole('link', {name: 'Harbor Point'})).toHaveCSS('text-decoration-line', 'none');
  await harbor.getByRole('link', {name: 'Ruth Ibarra'}).click();
  await expect(page).toHaveURL(/\/board\?owner=/);
  await expect(main.getByText('Next owner: Ruth Ibarra')).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(3);
  await totals.getByRole('link', {name: /^Visits at stake this week/}).click();
  await expect(page).toHaveURL('/schedule?view=at-stake');
  const visits = main.getByRole('region', {name: 'Planned visits'});
  await expect(visits.getByRole('link')).toHaveText(['Harbor Point', 'Hillcrest']);
  await main.getByRole('link', {name: 'Show full schedule'}).click();
  const crews = main.getByRole('region', {name: 'Crews this week'});
  await expect(crews.getByRole('listitem')).toHaveCount(10);
  await expect(crews).toContainText('No install. Hold day for power checks.');
  await expect(main.getByRole('region', {name: 'Morning log'})).toHaveCount(0);
  await boardNav.click();
  await totals.getByRole('link', {name: /^Failed visits this quarter/}).click();
  await expect(page).toHaveURL('/activity#failures-title');
  const failures = main.getByRole('region', {name: 'Failed visits this quarter'});
  await expect(failures.getByRole('listitem')).toHaveCount(3);
  await expect(failures.getByRole('link')).toHaveText(['Point Richmond']);
  await expect(main.getByRole('region', {name: 'Morning log'}).getByRole('listitem')).toHaveCount(8);
  await expect(main.getByRole('region', {name: 'Crews this week'})).toHaveCount(0);
  await failures.getByRole('link', {name: 'Point Richmond'}).click();
  await expect(page).toHaveURL('/sites/NRO-W-1891');
  await expect(main.getByRole('heading', {name: /Point Richmond/, level: 1})).toBeVisible();
  await nav.getByRole('link', {name: 'Programs', exact: true}).click();
  const westDesign = main.getByRole('region', {name: 'West Metro Cluster 4 design queue'});
  await expect(westDesign.getByRole('listitem')).toHaveCount(6);
  await expect(westDesign.getByRole('link')).toHaveCount(0);
});

test('search, filters and sorting change only the register; exception and row controls open their sites', async ({page}) => {
  await openWest(page);
  const main = page.getByRole('main');
  const table = main.getByRole('table', {name: 'Site readiness register'});
  const search = page.getByRole('combobox', {name: 'Search site id or name'});
  await expect(table.getByRole('row').nth(1)).toContainText('Harbor Point');
  await search.fill('not a released site');
  await expect(page.getByText('No site matches that name in West Metro Cluster 4.')).toBeVisible();
  await search.fill(' 1842 ');
  await expect(main.getByText('Showing 1 of 16 sites.')).toBeVisible();
  await expect(table.getByRole('row').nth(1)).toContainText('34%');
  await main.getByRole('button', {name: 'Green', exact: true}).click();
  await expect(main.getByText('Showing 0 of 16 sites.')).toBeVisible();
  await expect(main.getByRole('region', {name: 'Portfolio totals'})).toContainText(/8\s*of 16 sites/);
  await search.clear();
  const exceptions = main.getByRole('region', {name: 'Exceptions', exact: true});
  await exceptions.getByRole('link', {name: '1 source conflict', exact: true}).click();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('row').nth(1)).toContainText('Market DAS');
  const exception = exceptions.getByRole('link', {name: 'Market DAS', exact: true});
  await exception.focus();
  await expect(exception).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/sites/NRO-W-1855');
  await expect(main.getByRole('heading', {name: /Market DAS/, level: 1})).toBeVisible();
  // Use persistent navigation here; the site workspace owns its Board return control.
  await page.getByRole('navigation', {name: 'Program'}).getByRole('link', {name: 'Board', exact: true}).click();
  await expect(page).toHaveURL('/board');
  await expect(table.getByRole('row')).toHaveCount(17);
  await table.getByRole('button', {name: 'Readiness', exact: true}).click();
  await expect(table.getByRole('columnheader', {name: 'Readiness'})).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.getByRole('row').nth(1)).toContainText('Point Richmond');
  await table.getByRole('button', {name: 'Readiness', exact: true}).click();
  await expect(table.getByRole('columnheader', {name: 'Readiness'})).toHaveAttribute('aria-sort', 'descending');
  await expect(table.getByRole('row').nth(1)).toContainText('Civic Center');
  await expect(table.getByRole('row').last()).toContainText('Temescal');
  const neighborhood = table.getByRole('cell', {name: 'Oakland, Harbor Point', exact: true});
  await expect(neighborhood.getByRole('link')).toHaveCount(0);
  await neighborhood.click();
  await expect(page).toHaveURL('/sites/NRO-W-1842');
  await expect(main.getByRole('heading', {name: /Harbor Point/, level: 1})).toBeVisible();
});

test('program switching changes actual Board, Schedule, Activity and pending approval records', async ({page}) => {
  await openWest(page);
  const main = page.getByRole('main');
  const nav = page.getByRole('navigation', {name: 'Program'});
  const selector = page.getByRole('combobox', {name: 'Active program'});
  for (const [scope, cluster, site, depot, count, pending] of [
    ['east-bay', 'East Bay Cluster 2', 'Delta Landing', 'Delta Works Yard', 12, 'Marsh Junction'],
    ['north-valley', 'North Valley Cluster 1', 'Orchard Exchange', 'Orchard Field Depot', 2, null],
    ['south-shore', 'South Shore Cluster 7', 'Dune Crossing', 'Coast Operations Yard', 4, null],
  ]) {
    await selector.selectOption(scope);
    await expect(page).toHaveURL(`/board?program=${scope}`);
    await expect(selector).toHaveValue(scope);
    await expect(page.getByRole('contentinfo')).toContainText(cluster);
    const table = main.getByRole('table', {name: 'Site readiness register'});
    await expect(table.getByRole('row')).toHaveCount(count + 1);
    await expect(table.getByRole('link', {name: site, exact: true})).toBeVisible();
    await expect(table).not.toContainText('Harbor Point');
    await nav.getByRole('link', {name: 'Schedule', exact: true}).click();
    await expect(page).toHaveURL(`/schedule?program=${scope}`);
    const crews = main.getByRole('region', {name: 'Crews this week'});
    await expect(crews.getByRole('link', {name: site, exact: true})).toBeVisible();
    await expect(crews).toContainText(depot);
    await expect(crews).not.toContainText('West Metro Yard');
    await expect(main.getByRole('region', {name: 'Planned visits'})).toContainText(site);
    await nav.getByRole('link', {name: 'Activity', exact: true}).click();
    await expect(page).toHaveURL(`/activity?program=${scope}`);
    const log = main.getByRole('region', {name: 'Morning log'});
    await expect(log.getByRole('listitem')).toHaveCount(1);
    await expect(log).toContainText(site);
    await expect(log).not.toContainText('Harbor Point');
    const failures = main.getByRole('region', {name: 'Failed visits this quarter'});
    await expect(failures).toContainText(scope === 'south-shore' ? 'Crew turned away at the closed access gate.' : 'No failed visits this quarter.');
    await expect(failures).not.toContainText('Point Richmond');
    await nav.getByRole('link', {name: 'Approvals', exact: true}).click();
    await expect(page).toHaveURL(`/approvals?program=${scope}`);
    await expect(main).not.toContainText('Portside');
    if (pending) await expect(main.getByRole('link', {name: pending, exact: true})).toBeVisible();
    else await expect(main.getByRole('link', {name: 'Marsh Junction', exact: true})).toHaveCount(0);
    await nav.getByRole('link', {name: 'Board', exact: true}).click();
    await selector.selectOption('west-metro');
    await expect(page).toHaveURL('/board');
    await expect(main.getByRole('table').getByRole('link', {name: 'Harbor Point', exact: true})).toBeVisible();
  }
});

test.describe('mobile portfolio', () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

  test('keeps horizontal scroll inside the register and supports touch navigation and filtering', async ({page}) => {
    await page.goto('/login');
    await page.getByRole('button', {name: 'Continue as Marcus Hale'}).tap();
    await page.getByRole('link', {name: 'Open West Metro Cluster 4'}).tap();
    const register = page.getByRole('region', {name: 'Scrollable site readiness register'});
    const table = register.getByRole('table', {name: 'Site readiness register'});
    const documentOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await expect(table.getByRole('row')).toHaveCount(17);
    await expect.poll(documentOverflow).toBe(0);
    await expect.poll(() => register.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
    await register.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect.poll(() => register.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await expect.poll(documentOverflow).toBe(0);

    await page.getByRole('combobox', {name: 'Search site id or name'}).fill('1842');
    await page.getByRole('button', {name: 'Red', exact: true}).tap();
    await expect(page.getByText('Showing 1 of 16 sites.')).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect.poll(documentOverflow).toBe(0);
    await table.getByRole('link', {name: 'Harbor Point', exact: true}).tap();
    await expect(page).toHaveURL('/sites/NRO-W-1842');
    await expect(page.getByRole('heading', {name: /Harbor Point/, level: 1})).toBeVisible();

    await page.getByRole('combobox', {name: 'Search site id or name'}).fill('Point Richmond');
    await page.getByRole('listbox', {name: 'Matching sites'}).getByText('Point Richmond · NRO-W-1891', {exact: true}).tap();
    await expect(page).toHaveURL('/sites/NRO-W-1891');
    await expect(page.getByRole('heading', {name: /Point Richmond/, level: 1})).toBeVisible();
  });
});
