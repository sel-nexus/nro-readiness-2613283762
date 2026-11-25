/** Exercise recovery against the actual static app and browser storage. */
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

test('Samira retries a retained assessment offline without clearing the DDL interruption', async ({page, context}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Samira Qureshi'}).click();
  const portfolioFocus = page.getByRole('region', {name: 'Workshop focus'});
  await expect(portfolioFocus.getByRole('link', {name: 'Civic Center dispatch'})).toBeVisible();
  await page.getByRole('link', {name: 'Service health'}).click();
  const sources = page.getByRole('list', {name: 'Local sources'});
  const ddl = sources.getByRole('listitem').filter({has: page.getByRole('heading', {name: 'DDL', exact: true})});
  await expect(sources.getByRole('listitem')).toHaveCount(7);
  await expect(sources.getByRole('switch')).toHaveCount(2);
  await expect(sources.getByRole('listitem').filter({hasText: 'City portal'})).toContainText('Delayed');
  await ddl.getByRole('switch').click();
  await expect(page.getByRole('button', {name: 'DDL · Down · synced 09:22'})).toBeVisible();
  await ddl.getByRole('switch').click();
  await expect(page.getByRole('button', {name: 'DDL · Up · synced 09:22'})).toBeVisible();
  const assessmentSwitch = sources.getByRole('switch', {name: 'Assessment service manual outage'});
  await assessmentSwitch.click();
  await expect(assessmentSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', {name: 'DDL · Up · synced 09:22'})).toBeVisible();
  await assessmentSwitch.click();
  await expect(assessmentSwitch).toHaveAttribute('aria-checked', 'false');
  await page.getByLabel('Workshop scenario').selectOption({label: 'Service interruption'});
  await expect(page.getByRole('region', {name: 'Snapshot'})).toContainText('Showing the score from 12 May 2026 09:34');
  await expect(page.getByRole('button', {name: 'DDL · Down · synced 09:22'})).toBeVisible();

  // The app must complete these in-app journeys after the static bundle is loaded.
  await context.setOffline(true);
  await page.getByRole('link', {name: 'Open last assessment'}).click();
  const prediction = page.getByRole('region', {name: 'Assessment prediction'});
  await expect(prediction.getByRole('heading', {name: 'Last score · Historical'})).toBeVisible();
  await expect(prediction.getByText('34%', {exact: true})).toBeVisible();
  await prediction.getByRole('button', {name: 'Retry'}).click();
  await expect(prediction.getByRole('status')).toHaveText('Assessment service unavailable. No new score was returned.');
  await expect(prediction.getByText(/corr_1842_a/)).toBeVisible();
  await prediction.getByRole('button', {name: 'Retry'}).click();
  await expect(prediction.getByRole('status')).toHaveText('Assessment complete. Probability 34%.');
  await expect(prediction.getByText(/corr_1842_r1/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'DDL · Down · synced 09:22'})).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('region', {name: 'Snapshot'})).toContainText('corr_1842_r1');
  await expect(sources.getByRole('listitem').filter({hasText: 'Assessment service'})).toContainText('Up');
});

test('scenario selection highlights exceptions and opens Portside without granting approval', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Samira Qureshi'}).click();
  await page.getByRole('link', {name: 'Service health'}).click();
  const scenario = page.getByLabel('Workshop scenario');
  await scenario.selectOption({label: 'Exception'});
  await page.getByRole('link', {name: 'Portfolio', exact: true}).click();
  const focus = page.getByRole('region', {name: 'Workshop focus'});
  for (const name of ['Lakeside stale permit', 'Market DAS material conflict', 'Hillcrest low confidence', 'Harbor Point power blocker']) {
    await expect(focus.getByRole('link', {name})).toBeVisible();
  }
  await page.getByRole('link', {name: 'Service health'}).click();
  await scenario.selectOption({label: 'Consequential decision'});
  await expect(page).toHaveURL(/\/sites\/NRO-W-1866\?tab=approval$/);
  await expect(page.getByRole('tab', {name: 'Approval'})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Approver: Priya Raman · Pending approval')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Approve', exact: true})).toHaveCount(0);
  await page.goBack();
  await scenario.selectOption({label: 'Normal'});
  await expect(scenario.getByRole('option', {name: 'Normal'})).toHaveJSProperty('selected', true);
});

test('uses one confirmation from health, account and lockout; Escape does not restore', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Samira Qureshi'}).click();
  await page.getByRole('link', {name: 'Service health'}).click();
  await page.getByLabel('Workshop scenario').selectOption({label: 'Service interruption'});
  const opener = page.getByRole('button', {name: 'Restore morning snapshot…', exact: true});
  const dialog = page.getByRole('dialog', {name: 'Restore morning snapshot'});
  await opener.click();
  await expect(dialog).toContainText('Restores West Metro to the 09:40 record. Evidence edits and files added since then are removed.');
  await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByRole('button', {name: 'DDL · Down · synced 09:22'})).toBeVisible();

  await page.getByRole('link', {name: 'Portfolio', exact: true}).click();
  const account = page.getByRole('button', {name: /Samira Qureshi/});
  await account.click();
  await opener.click();
  await dialog.getByRole('button', {name: 'Restore morning snapshot', exact: true}).click();
  await expect(page.getByText('Morning snapshot restored', {exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Normal workshop focus'})).toBeVisible();
  await expect(account).toBeVisible();

  // Inject a corrupt document record to exercise genuine locked-board recovery after reload.
  await page.evaluate(() => localStorage.setItem('nro.demo.uploads', '{broken'));
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Board unavailable'})).toBeVisible();
  await opener.click();
  await dialog.getByRole('button', {name: 'Restore morning snapshot', exact: true}).click();
  await expect(page.getByText('Morning snapshot restored', {exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'West Metro Cluster 4'})).toBeVisible();
  await expect(account).toBeVisible();
});

test('a viewer cannot open Service health or restore a locked board', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Jordan Ellis'}).click();
  await page.goto('/service-health');
  await expect(page.getByText('Service health is limited to the cluster administrator.')).toBeVisible();
  await expect(page.getByRole('link', {name: 'Service health'})).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('nro.demo.uploads', '{broken'));
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Board unavailable'})).toBeVisible();
  await expect(page.getByRole('button', {name: /Restore morning snapshot/})).toHaveCount(0);
});
