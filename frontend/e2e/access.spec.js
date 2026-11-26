/** Exercise account entry, access guards, persona handoffs and shared shell controls. */
import {expect, test} from '@playwright/test';

const team = ['Priya Raman', 'Marcus Hale', 'Elena Voss', 'Andre Cole', 'Jordan Ellis', 'Samira Qureshi'];

const contextErrors = new WeakMap();
test.beforeEach(async ({page, context}) => {
  const errors = [];
  const watch = watched => {
    watched.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    watched.on('pageerror', error => errors.push(error.message));
  };
  watch(page);
  context.on('page', watch);
  contextErrors.set(context, errors);
});

test.afterEach(async ({context}) => {
  expect(contextErrors.get(context), 'Browser console errors and uncaught exceptions').toEqual([]);
});

test('a signed-out deep link to a protected site redirects to sign-in', async ({page}) => {
  await page.goto('/sites/NRO-W-1842?tab=prediction');
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', {name: 'Sign in'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Harbor Point'})).toHaveCount(0);
});

test('identical errors, password visibility, persisted login and guarded sign-out', async ({page}) => {
  await page.goto('/login');
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
  await expect(page.getByRole('heading', {name: 'Programs', exact: true})).toBeVisible();
  await page.reload();
  await page.getByRole('button', {name: 'Marcus Hale Rollout Manager'}).click();
  await page.getByRole('button', {name: 'Your access'}).click();
  await expect(page.getByText('NRO-E-10422')).toBeVisible();
  await expect(page.getByText('marcus.hale@harbor-ring.com')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', {name: 'Open West Metro Cluster 4'}).click();
  await page.getByRole('link', {name: 'Review Harbor Point'}).click();
  await expect(page).toHaveURL('/sites/NRO-W-1842');
  await page.getByRole('button', {name: 'Marcus Hale Rollout Manager'}).click();
  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page).toHaveURL('/login');
  await page.goBack();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', {name: 'Harbor Point'})).toHaveCount(0);
});

for (const name of team) {
  test(`Continue as ${name} opens the appropriate portfolio controls`, async ({page}) => {
    await page.goto('/login');
    await expect(page.getByRole('button', {name: /^Continue as /})).toHaveCount(6);
    await page.getByRole('button', {name: `Continue as ${name}`}).click();
    await expect(page.getByRole('heading', {name: 'Programs', exact: true})).toBeVisible();
    await expect(page.getByRole('link', {name: 'Service health'})).toHaveCount(name === 'Samira Qureshi' ? 1 : 0);
    for (const program of ['West Metro Cluster 4', 'East Bay Cluster 2', 'North Valley Cluster 1', 'South Shore Cluster 7']) {
      await page.getByRole('link', {name: `Open ${program}`}).click();
      await expect(page.getByRole('heading', {name: program, exact: true, level: 1})).toBeVisible();
      await page.getByRole('navigation', {name: 'Program', exact: true}).getByRole('link', {name: 'Programs'}).click();
    }
    await page.getByRole('button', {name: new RegExp(`^${name}`)}).click();
    await page.getByRole('button', {name: 'Sign out'}).click();
    await expect(page).toHaveURL('/login');
  });
}

test('a regional viewer’s first navigation to Service health replaces it with the portfolio', async ({page, context}) => {
  await page.goto('/login');
  await page.getByRole('button', {name: 'Continue as Jordan Ellis'}).click();
  await expect(page.getByRole('heading', {name: 'Programs', exact: true})).toBeVisible();
  await page.close();
  const direct = await context.newPage();
  await direct.goto('/service-health');
  await expect(direct).toHaveURL('/');
  await expect(direct.getByRole('status').filter({hasText: /^Service health is limited to the cluster administrator\.$/})).toBeVisible();
  await expect(direct.getByRole('heading', {name: 'Programs', exact: true})).toBeVisible();
  await expect(direct.getByRole('heading', {name: 'Service health', exact: true})).toHaveCount(0);
  await expect(direct.getByRole('link', {name: 'Service health'})).toHaveCount(0);
});

test('switching to the facilitator clears search and exposes Service health navigation', async ({page}) => {
  await page.goto('/login');
  await page.getByRole('button', {name: 'Continue as Jordan Ellis'}).click();
  await page.getByRole('combobox', {name: 'Search site id or name'}).fill('Harbor');
  await expect(page.getByRole('option')).toContainText('Harbor Point');
  await page.getByRole('button', {name: 'Jordan Ellis Regional Viewer'}).click();
  await page.getByRole('button', {name: 'Switch user'}).click();
  await page.getByRole('button', {name: 'Samira Qureshi · Cluster Administrator'}).click();
  await expect(page.getByRole('combobox', {name: 'Search site id or name'})).toHaveValue('');
  await page.getByRole('link', {name: 'Service health'}).click();
  await expect(page).toHaveURL('/service-health');
  await expect(page.getByRole('heading', {name: 'Service health', exact: true})).toBeVisible();
});

for (const [path, heading] of [['/sites/NRO-W-1902', 'Site not found'], ['/not-a-board-route', 'Page not found']]) {
  test(`an administrator’s first navigation to ${path} shows ${heading}`, async ({page, context}) => {
    await page.goto('/login');
    await page.getByRole('button', {name: 'Continue as Samira Qureshi'}).click();
    await expect(page.getByRole('heading', {name: 'Programs', exact: true})).toBeVisible();
    await page.close();
    const direct = await context.newPage();
    await direct.goto(path);
    await expect(direct).toHaveURL(path);
    await expect(direct.getByRole('heading', {name: heading, exact: true})).toBeVisible();
    await expect(direct.getByRole('tablist', {name: 'Site workspace'})).toHaveCount(0);
    await direct.getByRole('link', {name: 'Back to Programs'}).click();
    await expect(direct).toHaveURL('/');
    await expect(direct.getByRole('heading', {name: 'Programs', exact: true})).toBeVisible();
  });
}

test('a signed-in dispatcher opens a protected prediction on the first navigation of a fresh page', async ({page, context}) => {
  await page.goto('/login');
  await page.getByRole('button', {name: 'Continue as Andre Cole'}).click();
  await expect(page.getByRole('heading', {name: 'Programs', exact: true})).toBeVisible();
  await page.close();
  const direct = await context.newPage();
  await direct.goto('/sites/NRO-W-1842?tab=prediction');
  await expect(direct).toHaveURL('/sites/NRO-W-1842?tab=prediction');
  await expect(direct.getByRole('heading', {name: 'Harbor Point', level: 1})).toBeVisible();
  await expect(direct.getByRole('tab', {name: 'Prediction', selected: true})).toBeVisible();
});

test('notices retain unread state; site suggestions and guide support keyboard navigation', async ({page}) => {
  await page.goto('/login');
  await page.getByRole('button', {name: 'Continue as Andre Cole'}).click();
  const notices = page.getByRole('button', {name: 'Notifications, 8 unread'});
  await notices.click();
  const noticeList = page.getByRole('region', {name: 'Notifications'});
  await expect(noticeList.getByRole('link')).toHaveCount(12);
  await expect(noticeList.getByRole('link').first()).toContainText('Harbor Point power still Not Ready');
  await noticeList.getByRole('link').first().click();
  await expect(page).toHaveURL('/sites/NRO-W-1842');
  await expect(notices).toBeVisible();
  const lookup = page.getByRole('combobox', {name: 'Search site id or name'});
  await lookup.fill('point');
  await lookup.press('Enter');
  await expect(page).toHaveURL('/sites/NRO-W-1842');
  await expect(page.getByRole('option')).toHaveCount(2);
  await lookup.press('ArrowDown');
  await expect(page.getByRole('option', {selected: true})).toHaveText('Point Richmond · NRO-W-1891');
  await lookup.press('Enter');
  await expect(page).toHaveURL('/sites/NRO-W-1891');
  await expect(page.getByRole('heading', {name: 'Point Richmond', level: 1})).toBeVisible();
  const account = page.getByRole('button', {name: 'Andre Cole Field Dispatcher'});
  await account.click();
  await page.getByRole('button', {name: 'Scores and approvals'}).click();
  await expect(page.getByRole('dialog', {name: 'Scores and approvals'})).toContainText('Contributions are not causes');
  await page.keyboard.press('Escape');
  await expect(account).toBeFocused();
});

test('switching programs preserves the route, clears scoped results and survives refresh', async ({page}) => {
  await page.goto('/login');
  await page.getByRole('button', {name: 'Continue as Priya Raman'}).click();
  await page.getByRole('link', {name: 'Open East Bay Cluster 2'}).click();
  await expect(page).toHaveURL('/board?program=east-bay');
  const nav = page.getByRole('navigation', {name: 'Program', exact: true});
  await expect(nav.getByRole('link', {name: 'Board'})).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', {name: 'Board'})).toHaveCSS('background-color', 'rgb(0, 130, 240)');
  await expect(nav.getByRole('link', {name: 'Service health'})).toHaveCount(0);
  const search = page.getByRole('combobox', {name: 'Search site id or name'});
  await search.fill('Harbor Point');
  await expect(page.getByText('No site matches that name in East Bay Cluster 2.')).toBeVisible();
  await nav.getByRole('link', {name: 'Schedule'}).click();
  await expect(page.getByRole('link', {name: 'Delta Landing'})).toBeVisible();
  const program = page.getByLabel('Active program');
  await program.selectOption('south-shore');
  await expect(page).toHaveURL('/schedule?program=south-shore');
  await expect(page.getByRole('link', {name: 'Dune Crossing'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Delta Landing'})).toHaveCount(0);
  await page.reload();
  await expect(program).toHaveValue('south-shore');
  await expect(page.getByRole('contentinfo')).toContainText('South Shore Cluster 7');
  await nav.getByRole('link', {name: 'Activity'}).click();
  await expect(page.getByRole('region', {name: 'Failed visits'})).toContainText('Dune Crossing');
});
