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
  await expect(boardNav).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(boardNav).toHaveCSS('text-decoration-line', 'none');
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', {name: 'NRO Readiness', exact: true})).toBeVisible();
  await expect(header).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByText('NRO Readiness', {exact: true})).toBeVisible();
  await expect(footer.getByText('West Metro Cluster 4', {exact: true})).toBeVisible();
  await expect(footer).toHaveCSS('background-color', 'rgb(0, 52, 96)');
  await expect(footer).toHaveCSS('color', 'rgb(255, 255, 255)');
  const main = page.getByRole('main');
  const blocks = main.locator('[aria-label="Program Board"] > section');
  await expect(blocks).toHaveCount(5);
  await expect(blocks.nth(0)).toContainText('Harbor Point is on hold. Power is not ready.');
  const review = blocks.nth(0).getByRole('link', {name: 'Review Harbor Point'});
  await expect(review).toHaveAttribute('href', '/sites/NRO-W-1842');
  await expect(review).toHaveCSS('background-color', 'rgb(0, 130, 240)');
  await expect(review).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(main.getByRole('heading', {name: 'West Metro Cluster 4', level: 1})).toHaveCSS('color', 'rgb(12, 12, 12)');
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
  await expect(totals.getByText('of 16 sites', {exact: true})).toHaveCSS('color', 'rgb(107, 114, 128)');
  await expect(readiness).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(main.getByRole('heading', {name: /Morning log|Crews this week|Planned visits|Design queue|Cluster schematic|Normal workshop focus/})).toHaveCount(0);
  await expect(main.getByRole('button', {name: 'How to read this'})).toHaveCount(0);
  await expect(main.getByText('Mandela Parkway', {exact: true})).toHaveCount(0);

  await totals.getByRole('link', {name: /^Sites at risk/}).click();
  await expect(table.getByRole('row')).toHaveCount(9);
  await totals.getByRole('link', {name: /^On air this month/}).click();
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('row').last()).toContainText('Temescal');
  await main.getByRole('link', {name: 'Clear filters'}).click();
  const harbor = table.getByRole('row').filter({has: page.getByRole('link', {name: 'Harbor Point', exact: true})});
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
  await expect(westDesign).toHaveCSS('background-color', 'rgb(245, 247, 250)');
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
  await main.getByRole('link', {name: 'Board', exact: true}).click();
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
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByText('NRO Readiness', {exact: true})).toBeVisible();
    await expect(footer.getByText(cluster, {exact: true})).toBeVisible();
    await expect(footer).not.toContainText('West Metro Cluster 4');
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
    if (pending) await expect(main.getByRole('link', {name: `Open ${pending} approval`, exact: true})).toBeVisible();
    else await expect(main.getByRole('link', {name: 'Open Marsh Junction approval', exact: true})).toHaveCount(0);
    await nav.getByRole('link', {name: 'Board', exact: true}).click();
    await expect(page).toHaveURL(`/board?program=${scope}`);
    await expect(main.getByRole('table', {name: 'Site readiness register'})).toBeVisible();
    await selector.selectOption('west-metro');
    await expect(page).toHaveURL('/board');
    await expect(main.getByRole('table').getByRole('link', {name: 'Harbor Point', exact: true})).toBeVisible();
  }
});

for (const [profile, options] of [
  ['tablet', {viewport: {width: 768, height: 1024}, isMobile: true, hasTouch: true}],
  // Half a 1366×768 desktop CSS viewport is a 200% reflow proxy. Native browser zoom is not tested.
  ['200% desktop reflow', {viewport: {width: 683, height: 384}, deviceScaleFactor: 2}],
]) {
  test.describe(`RG08 ${profile}`, () => {
    test.use(options);

    test('contains table overflow and reaches Prediction and the scoped Board return', async ({page}) => {
      await openWest(page);
      const main = page.getByRole('main');
      const register = main.getByRole('region', {name: 'Scrollable site readiness register'});
      const noDocumentOverflow = () => expect.poll(() => page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      const technicalIds = /nro-readiness-sim|\bcorr_|\bsnap_|\bECO-|\b(?:crew|exec|dec|opt)_[\w-]+|NRO-E-104\d{2}/;
      const fullPhone = /(?:\+1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/;
      const assistantControl = /\b(?:assistant|chat(?:bot)?|copilot|sparkle|ask ai|prompt|model picker|model selector|(?:choose|select|switch) (?:a |the )?model)\b/i;
      const noRestrictedContent = async () => {
        await expect(page.locator('body')).not.toContainText(/\bnro\.demo\./i);
        await expect(page.locator('body')).not.toContainText(/\bcontract\s+pric(?:e|ing)\b|[$€£]\s*\d|\b(?:USD|EUR|GBP)\s*\d|\d\s*(?:USD|EUR|GBP)\b/i);
        await expect(page.locator('body')).not.toContainText(fullPhone);
        for (const role of ['button', 'link', 'textbox', 'tab', 'combobox', 'listbox', 'dialog']) {
          await expect(page.getByRole(role, {name: assistantControl})).toHaveCount(0);
        }
        await expect(page.getByRole('combobox', {name: /^model$/i})).toHaveCount(0);
        await expect(page.getByPlaceholder(assistantControl)).toHaveCount(0);
      };
      const visibleFocus = async locator => {
        await expect(locator).toBeFocused();
        await expect(locator).toHaveCSS('outline-style', 'solid');
        await expect(locator).toHaveCSS('outline-width', '2px');
        await expect(locator).toHaveCSS('outline-color', 'rgb(0, 52, 96)');
      };
      await expect(register.getByRole('row')).toHaveCount(17);
      await noDocumentOverflow();
      await expect.poll(() => register.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
      await page.keyboard.press('Tab');
      await register.focus();
      await register.press('ArrowRight');
      await visibleFocus(register);
      await expect.poll(() => register.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      await expect(page.locator('body')).not.toContainText(technicalIds);
      await noRestrictedContent();

      await main.getByRole('link', {name: 'Review Harbor Point', exact: true}).click();
      await expect(page).toHaveURL('/sites/NRO-W-1842');
      await expect(main.getByRole('table', {name: 'Evidence matrix', exact: true})).toBeVisible();
      await noDocumentOverflow();
      await expect(page.locator('body')).not.toContainText(technicalIds);
      const evidence = main.getByRole('table', {name: 'Evidence matrix', exact: true});
      await expect(evidence.getByText(/^Phone ending in \d{4}$/).first()).toBeVisible();
      await expect(evidence.locator('a[href^="tel:"]')).toHaveCount(0);
      await noRestrictedContent();
      await page.keyboard.press('Tab');
      await main.getByRole('tab', {name: 'Evidence', exact: true}).press('ArrowRight');
      const predictionTab = main.getByRole('tab', {name: 'Prediction', exact: true, selected: true});
      await visibleFocus(predictionTab);
      const prediction = main.getByRole('region', {name: 'Assessment prediction', exact: true});
      await expect(prediction.getByText('34%', {exact: true})).toBeVisible();
      await expect(prediction).toContainText('Confidence: 86% · High');
      await expect(prediction).toContainText('nro-readiness-sim 1.4.2 · corr_1842_a');
      await expect(main.locator('#site-plan')).not.toContainText(technicalIds);
      await noRestrictedContent();
      await noDocumentOverflow();

      const back = main.getByRole('link', {name: 'Board', exact: true});
      await expect(back).toHaveAttribute('href', '/board');
      await back.press('Enter');
      await expect(page).toHaveURL('/board');
      await expect(register.getByRole('row')).toHaveCount(17);
      await noDocumentOverflow();
    });
  });
}

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
