/** Exercise signed-in navigation, account handoffs and full-board portfolio triage. */
import {expect, test} from '@playwright/test';

const team = ['Priya Raman', 'Marcus Hale', 'Elena Voss', 'Andre Cole', 'Jordan Ellis', 'Samira Qureshi'];

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

test('signed-out route guard, identical errors, password visibility, persisted login and guarded sign-out', async ({page}) => {
  await page.goto('/sites/NRO-W-1842?tab=prediction');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', {name: 'Sign in'})).toBeVisible();
  const email = page.getByLabel('Email', {exact: true});
  const password = page.getByLabel('Password', {exact: true});
  const submit = page.getByRole('button', {name: 'Sign in', exact: true});
  for (const address of ['unknown@example.invalid', 'marcus.hale@harbor-ring.com']) {
    await email.fill(address);
    await password.fill('wrong');
    await page.getByRole('button', {name: 'Show password'}).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', {name: 'Hide password'}).click();
    await expect(password).toHaveAttribute('type', 'password');
    await submit.click();
    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
    await expect(password).toHaveValue('');
  }
  await email.fill('MARCUS.HALE@HARBOR-RING.COM');
  await password.fill(`Nr0-${team[1].split(' ')[0]}#1842`);
  await submit.click();
  await expect(page.getByRole('heading', {name: 'West Metro Cluster 4'})).toBeVisible();
  await page.reload();
  await page.getByRole('button', {name: 'Marcus Hale Rollout Manager'}).click();
  await page.getByRole('button', {name: 'Your access'}).click();
  await expect(page.getByText('NRO-E-10422')).toBeVisible();
  await expect(page.getByText('marcus.hale@harbor-ring.com')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', {name: 'Review Harbor Point'}).click();
  await expect(page).toHaveURL(/\/sites\/NRO-W-1842$/);
  await page.getByRole('button', {name: 'Marcus Hale Rollout Manager'}).click();
  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', {name: 'Harbor Point'})).toHaveCount(0);
});

test('all six Continue choices, viewer restriction and explicit facilitator switch', async ({page}) => {
  for (const name of team) {
    await page.goto('/login');
    await expect(page.getByRole('button', {name: /^Continue as /})).toHaveCount(6);
    await page.getByRole('button', {name: `Continue as ${name}`}).click();
    await expect(page.getByRole('heading', {name: 'West Metro Cluster 4'})).toBeVisible();
    await expect(page.getByRole('link', {name: 'Service health'})).toHaveCount(name === 'Samira Qureshi' ? 1 : 0);
    await expect(page.getByRole('link', {name: 'Review Harbor Point'})).toHaveCount(['Jordan Ellis', 'Samira Qureshi'].includes(name) ? 0 : 1);
    await page.getByRole('button', {name: new RegExp(`^${name}`)}).click();
    await page.getByRole('button', {name: 'Sign out'}).click();
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.getByRole('button', {name: 'Continue as Jordan Ellis'}).click();
  await page.goto('/service-health');
  await expect(page.getByText('Service health is limited to the cluster administrator.')).toBeVisible();
  await page.getByRole('searchbox', {name: 'Search site id or name'}).fill('Harbor');
  await page.getByRole('button', {name: 'Jordan Ellis Regional Viewer'}).click();
  await page.getByRole('button', {name: 'Switch user'}).click();
  await page.getByRole('button', {name: 'Samira Qureshi · Cluster Administrator'}).click();
  await expect(page.getByRole('searchbox', {name: 'Search site id or name'})).toHaveValue('');
  await page.getByRole('link', {name: 'Service health'}).click();
  await expect(page).toHaveURL(/\/service-health$/);
  await expect(page.getByRole('heading', {name: 'Service health', exact: true})).toBeVisible();
  await page.goto('/sites/NRO-W-1902');
  await expect(page.getByRole('heading', {name: 'Site not found'})).toBeVisible();
});

test('search, chips, exceptions and sorting only change visible sites, not history or totals', async ({page}) => {
  await page.goto('/');
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
  await expect(page.getByRole('region', {name: 'Portfolio totals'})).toContainText('8');
  await expect(page.getByRole('region', {name: 'This morning'}).getByRole('listitem')).toHaveCount(8);
  await expect(page.getByRole('region', {name: 'Crews this week'}).getByRole('listitem')).toHaveCount(10);
  await expect(page.getByRole('region', {name: 'Crews this week'})).toContainText('No install. Hold day for power checks.');
  await expect(page.getByRole('region', {name: 'Failed visits this quarter'}).getByRole('link')).toHaveCount(1);
  await expect(page.getByRole('region', {name: 'Not on the board yet'}).getByRole('listitem')).toHaveCount(6);
  await expect(page.getByRole('region', {name: 'Not on the board yet'}).getByRole('link')).toHaveCount(0);
  await search.fill('');
  await page.getByRole('button', {name: '1 source conflict'}).click();
  await expect(table.getByRole('row').nth(1)).toContainText('Market DAS');
  await expect(page.getByRole('region', {name: 'Cluster schematic'}).getByRole('link')).toHaveCount(1);
  await page.getByRole('button', {name: 'All', exact: true}).click();
  await table.getByRole('button', {name: 'Readiness', exact: true}).click();
  await expect(table.getByRole('columnheader', {name: 'Readiness'})).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.getByRole('row').nth(1)).toContainText('Point Richmond');
  await table.getByRole('button', {name: 'Readiness', exact: true}).click();
  await expect(table.getByRole('columnheader', {name: 'Readiness'})).toHaveAttribute('aria-sort', 'descending');
  await expect(table.getByRole('row').nth(1)).toContainText('Civic Center');
  await expect(table.getByRole('row').last()).toContainText('Temescal');
});

test('notices retain unread state; site suggestions and guide support keyboard navigation', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Andre Cole'}).click();
  const notices = page.getByRole('button', {name: 'Notifications, 8 unread'});
  await notices.click();
  const noticeList = page.getByRole('region', {name: 'Notifications'});
  await expect(noticeList.getByRole('link')).toHaveCount(12);
  await expect(noticeList.getByRole('link').first()).toContainText('Harbor Point power still Not Ready');
  await noticeList.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/sites\/NRO-W-1842$/);
  await expect(notices).toBeVisible();
  const lookup = page.getByRole('combobox', {name: 'Search site id or name'});
  await lookup.fill('point');
  await lookup.press('Enter');
  await expect(page).toHaveURL(/\/sites\/NRO-W-1842$/);
  await expect(page.getByRole('option')).toHaveCount(2);
  await lookup.press('ArrowDown');
  await lookup.press('Enter');
  await expect(page).toHaveURL(/\/sites\/NRO-W-1891$/);
  const guide = page.getByRole('button', {name: 'How to read this'});
  await guide.click();
  await expect(page.getByRole('dialog', {name: 'How to read this'})).toContainText('Contributions are not causes');
  await page.keyboard.press('Escape');
  await expect(guide).toBeFocused();
});
