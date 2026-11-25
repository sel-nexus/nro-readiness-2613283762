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

test('search, chips, exceptions and sorting change visible sites without changing history or totals', async ({page}) => {
  await page.goto('/login');
  await page.getByRole('button', {name: 'Continue as Marcus Hale'}).click();
  const table = page.getByRole('table', {name: 'Site readiness register'});
  const search = page.getByRole('searchbox', {name: 'Search site id or name'});
  await expect(table.getByRole('row')).toHaveCount(17);
  await expect(table.getByRole('row').nth(1)).toContainText('Harbor Point');
  await search.fill(' 1842 ');
  await expect(page.getByText('Showing 1 of 16 sites.')).toBeVisible();
  await expect(table.getByRole('row').nth(1)).toContainText('34%');
  await page.getByRole('button', {name: 'Green', exact: true}).click();
  await expect(page.getByText('No site matches that name in West Metro Cluster 4.', {exact: false})).toBeVisible();
  await expect(page.getByRole('region', {name: 'Portfolio totals'})).toContainText(/8\s*of 16 sites/);
  await expect(page.getByRole('region', {name: 'This morning'}).getByRole('listitem')).toHaveCount(8);
  await expect(page.getByRole('region', {name: 'Crews this week'}).getByRole('listitem')).toHaveCount(10);
  await expect(page.getByRole('region', {name: 'Crews this week'})).toContainText('No install. Hold day for power checks.');
  await expect(page.getByRole('region', {name: 'Failed visits this quarter'}).getByRole('link')).toHaveCount(1);
  await expect(page.getByRole('region', {name: 'Not on the board yet'}).getByRole('listitem')).toHaveCount(6);
  await expect(page.getByRole('region', {name: 'Not on the board yet'}).getByRole('link')).toHaveCount(0);

  await search.clear();
  const exceptions = page.getByRole('region', {name: 'Exceptions', exact: true});
  await exceptions.getByRole('button', {name: '1 source conflict', exact: true}).click();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('row').nth(1)).toContainText('Market DAS');
  const schematic = page.getByRole('region', {name: 'Cluster schematic'});
  await expect(schematic.getByRole('link')).toHaveCount(1);
  const pin = schematic.getByRole('link', {name: 'Market DAS · NRO-W-1855 · Amber', exact: true});
  await pin.focus();
  await expect(pin).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/sites/NRO-W-1855');
  await expect(page.getByRole('heading', {name: 'Market DAS', level: 1})).toBeVisible();
  await page.getByRole('link', {name: 'Back to Portfolio'}).click();
  await expect(page).toHaveURL('/');
  await page.getByRole('button', {name: 'All', exact: true}).click();
  await expect(table.getByRole('row')).toHaveCount(17);

  await table.getByRole('button', {name: 'Readiness', exact: true}).click();
  await expect(table.getByRole('columnheader', {name: 'Readiness'})).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.getByRole('row').nth(1)).toContainText('Point Richmond');
  await table.getByRole('button', {name: 'Readiness', exact: true}).click();
  await expect(table.getByRole('columnheader', {name: 'Readiness'})).toHaveAttribute('aria-sort', 'descending');
  await expect(table.getByRole('row').nth(1)).toContainText('Civic Center');
  await expect(table.getByRole('row').last()).toContainText('Temescal');
});

test('named exceptions, released failed visits and a non-link register cell open their workspaces', async ({page}) => {
  await page.goto('/login');
  await page.getByRole('button', {name: 'Continue as Marcus Hale'}).click();
  const back = page.getByRole('link', {name: 'Back to Portfolio', exact: true});
  const exceptions = page.getByRole('region', {name: 'Exceptions', exact: true});
  await exceptions.getByRole('link', {name: 'Market DAS', exact: true}).click();
  await expect(page).toHaveURL('/sites/NRO-W-1855');
  await expect(page.getByRole('heading', {name: 'Market DAS', level: 1})).toBeVisible();
  await back.click();
  await expect(page).toHaveURL('/');

  const failures = page.getByRole('region', {name: 'Failed visits this quarter', exact: true});
  await failures.getByRole('link', {name: 'Point Richmond', exact: true}).click();
  await expect(page).toHaveURL('/sites/NRO-W-1891');
  await expect(page.getByRole('heading', {name: 'Point Richmond', level: 1})).toBeVisible();
  await back.click();
  await expect(page).toHaveURL('/');

  const table = page.getByRole('table', {name: 'Site readiness register'});
  const harbor = table.getByRole('row').filter({has: page.getByRole('link', {name: 'Harbor Point', exact: true})});
  const neighborhood = harbor.getByRole('cell', {name: 'Oakland, Harbor Point', exact: true});
  await expect(neighborhood.getByRole('link')).toHaveCount(0);
  await neighborhood.click();
  await expect(page).toHaveURL('/sites/NRO-W-1842');
  await expect(page.getByRole('heading', {name: 'Harbor Point', level: 1})).toBeVisible();
});

test.describe('mobile portfolio', () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

  test('keeps horizontal scroll inside the register and supports touch navigation and filtering', async ({page}) => {
    await page.goto('/login');
    await page.getByRole('button', {name: 'Continue as Marcus Hale'}).tap();
    const register = page.getByRole('region', {name: 'Scrollable site readiness register'});
    const table = register.getByRole('table', {name: 'Site readiness register'});
    const documentOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await expect(table.getByRole('row')).toHaveCount(17);
    await expect.poll(documentOverflow).toBe(0);
    await expect.poll(() => register.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
    await register.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect.poll(() => register.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await expect.poll(documentOverflow).toBe(0);

    await page.getByRole('searchbox', {name: 'Search site id or name'}).fill('1842');
    await page.getByRole('button', {name: 'Red', exact: true}).tap();
    await expect(page.getByText('Showing 1 of 16 sites.')).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect.poll(documentOverflow).toBe(0);
    await table.getByRole('link', {name: 'Harbor Point', exact: true}).tap();
    await expect(page).toHaveURL('/sites/NRO-W-1842');
    await expect(page.getByRole('heading', {name: 'Harbor Point', level: 1})).toBeVisible();

    await page.getByRole('combobox', {name: 'Search site id or name'}).fill('Point Richmond');
    await page.getByRole('listbox', {name: 'Matching sites'}).getByText('Point Richmond · NRO-W-1891', {exact: true}).tap();
    await expect(page).toHaveURL('/sites/NRO-W-1891');
    await expect(page.getByRole('heading', {name: 'Point Richmond', level: 1})).toBeVisible();
  });
});
