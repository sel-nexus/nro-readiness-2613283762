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

test('Samira runs during the outage, keeps the score, then retries twice offline without clearing DDL', async ({page, context}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Samira Qureshi'}).click();
  await expect(page.getByRole('heading', {name: 'Programs', level: 1})).toBeVisible();
  await page.getByRole('link', {name: 'Open West Metro Cluster 4'}).click();
  await expect(page.getByRole('table', {name: 'Site readiness register'}).getByRole('link', {name: 'Civic Center', exact: true})).toBeVisible();
  await page.getByRole('link', {name: 'Service health'}).click();
  await expect(page).toHaveURL('/service-health');
  const sources = page.getByRole('list', {name: 'Local sources'});
  const ddl = sources.getByRole('listitem').filter({has: page.getByRole('heading', {name: 'DDL', exact: true})});
  await expect(sources.getByRole('listitem')).toHaveCount(7);
  await expect(sources.getByRole('switch')).toHaveCount(2);
  await expect(sources.getByRole('listitem').filter({hasText: 'City portal'})).toContainText('Delayed');
  await ddl.getByRole('switch').click();
  await expect(page.getByRole('button', {name: 'DDL · Down · synced 09:22'})).toBeVisible();
  await ddl.getByRole('switch').click();
  await expect(page.getByRole('button', {name: 'DDL · Up · synced 09:22'})).toBeVisible();
  const assessment = sources.getByRole('listitem').filter({has: page.getByRole('heading', {name: 'Assessment service', exact: true})});
  // The status badge and the manual switch can show different states.
  const assessmentStatus = assessment.locator('h3 + span');
  const assessmentSwitch = assessment.getByRole('switch', {name: 'Assessment service manual outage'});
  await assessmentSwitch.click();
  await expect(assessmentSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(assessmentStatus).toHaveText('Down');
  await expect(page.getByRole('button', {name: 'DDL · Up · synced 09:22'})).toBeVisible();
  await assessmentSwitch.click();
  await expect(assessmentSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(assessmentStatus).toHaveText('Up');
  await page.getByLabel('Workshop scenario').selectOption({label: 'Service interruption'});
  const snapshot = page.getByRole('region', {name: 'Snapshot'});
  await expect(snapshot).toContainText('700 ms (simulated)');
  await expect(snapshot).toContainText('Showing the score from 12 May 2026 09:34');
  await expect(assessmentStatus).toHaveText('Down');
  await expect(assessmentSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', {name: 'DDL · Down · synced 09:22'})).toBeVisible();

  // The app must complete these in-app journeys after the static bundle is loaded.
  const offlineRequests = [];
  page.on('request', request => offlineRequests.push(request.url()));
  await context.setOffline(true);
  await page.getByRole('link', {name: 'Open last assessment'}).click();
  await expect(page).toHaveURL('/sites/NRO-W-1842?tab=prediction');
  const prediction = page.getByRole('region', {name: 'Assessment prediction'});
  const historical = prediction.getByRole('heading', {name: 'Last score · Historical'});
  const probability = prediction.getByText('34%', {exact: true});
  const confidence = prediction.getByText('Confidence: 86% · High', {exact: true});
  const retained = prediction.getByText('Scored 12 May 2026 09:34 · nro-readiness-sim 1.4.2 · corr_1842_a', {exact: true});
  const retry = prediction.getByRole('button', {name: 'Retry', exact: true});
  const keep = prediction.getByRole('button', {name: 'Keep last score', exact: true});
  const unavailable = 'Assessment service unavailable. No new score was returned.';
  const audit = page.getByRole('tab', {name: /^Audit \(\d+\)$/});
  const originalAudit = Number((await audit.textContent()).match(/\d+/)[0]);
  await expect(historical).toBeVisible();
  await expect(probability).toBeVisible();
  await expect(confidence).toBeVisible();
  await expect(retained).toBeVisible();
  await prediction.getByRole('button', {name: 'Run assessment', exact: true}).click();
  await expect(prediction.getByRole('status')).toHaveText(unavailable);
  await expect(audit).toHaveText(`Audit (${originalAudit + 1})`);
  await expect(retained).toBeVisible();

  await keep.click();
  await expect(prediction.getByRole('status')).toHaveText('Last score retained.');
  await expect(retry).toHaveCount(0);
  await expect(keep).toHaveCount(0);
  await expect(historical).toBeVisible();
  await expect(probability).toBeVisible();
  await expect(confidence).toBeVisible();
  await expect(retained).toBeVisible();
  await expect(audit).toHaveText(`Audit (${originalAudit + 1})`);

  // Keep must leave the shared snapshot and the effective outage unchanged as well.
  await page.goBack();
  await expect(page).toHaveURL('/service-health');
  await expect(snapshot.locator('time')).toHaveText('12 May 2026 09:34');
  await expect(snapshot.locator('time')).toHaveAttribute('datetime', '2026-05-12T09:34:00');
  await expect(snapshot.getByText('corr_1842_a', {exact: true})).toBeVisible();
  await expect(assessmentStatus).toHaveText('Down');
  await page.getByRole('link', {name: 'Open last assessment'}).click();
  await expect(page).toHaveURL('/sites/NRO-W-1842?tab=prediction');
  await retry.click();
  await expect(prediction.getByRole('status')).toHaveText(unavailable);
  await expect(historical).toBeVisible();
  await expect(probability).toBeVisible();
  await expect(confidence).toBeVisible();
  await expect(retained).toBeVisible();
  await expect(audit).toHaveText(`Audit (${originalAudit + 2})`);
  await retry.click();
  await expect(prediction.getByRole('status')).toHaveText('Assessment complete. Probability 34%.');
  await expect(prediction.getByRole('heading', {name: 'Readiness probability'})).toBeVisible();
  await expect(prediction.getByText('Scored 12 May 2026 09:40 · nro-readiness-sim 1.4.2 · corr_1842_r1', {exact: true})).toBeVisible();
  await expect(historical).toHaveCount(0);
  await expect(retained).toHaveCount(0);
  await expect(audit).toHaveText(`Audit (${originalAudit + 3})`);
  await audit.click();
  await expect(page).toHaveURL('/sites/NRO-W-1842?tab=audit');
  const history = page.getByRole('region', {name: 'Audit', exact: true});
  await expect(history.getByText('Assessment failed · 12 May 2026 09:40 · Samira Qureshi', {exact: true})).toHaveCount(2);
  await expect(history.getByText('Scored · 12 May 2026 09:40 · nro-readiness-sim 1.4.2', {exact: true})).toHaveCount(1);
  await expect(history.getByText('Scored · 12 May 2026 09:34 · nro-readiness-sim 1.4.2', {exact: true})).toHaveCount(1);
  await expect(page.getByRole('button', {name: 'DDL · Down · synced 09:22'})).toBeVisible();
  await page.getByRole('link', {name: 'Back to Board', exact: true}).click();
  await page.getByRole('link', {name: 'Service health'}).click();
  await expect(page).toHaveURL('/service-health');
  await expect(snapshot.locator('time')).toHaveText('12 May 2026 09:40');
  await expect(snapshot.locator('time')).toHaveAttribute('datetime', '2026-05-12T09:40:00');
  await expect(snapshot.getByText('corr_1842_r1', {exact: true})).toBeVisible();
  await expect(assessmentStatus).toHaveText('Up');
  await expect(ddl.locator('h3 + span')).toHaveText('Down');
  expect(offlineRequests).toEqual([]);
});

test('scenario selection highlights exceptions and opens Portside without granting approval', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Samira Qureshi'}).click();
  await page.getByRole('link', {name: 'Service health'}).click();
  const scenario = page.getByLabel('Workshop scenario');
  await scenario.selectOption({label: 'Exception'});
  await page.getByRole('link', {name: 'Board', exact: true}).click();
  const register = page.getByRole('table', {name: 'Site readiness register'});
  for (const [name, detail] of [['Lakeside', 'Permit · stale'], ['Market DAS', 'Material · conflict'], ['Hillcrest', '48%'], ['Harbor Point', 'Power · Not Ready']]) {
    await expect(register.getByRole('row').filter({has: register.getByRole('link', {name, exact: true})})).toContainText(detail);
  }
  await page.getByRole('link', {name: 'Service health'}).click();
  await scenario.selectOption({label: 'Consequential decision'});
  await expect(page).toHaveURL('/sites/NRO-W-1866?tab=approval');
  await expect(page.getByRole('tab', {name: 'Approval'})).toHaveAttribute('aria-selected', 'true');
  const approval = page.getByRole('region', {name: 'Approval', exact: true});
  const approve = approval.getByRole('button', {name: 'Approve', exact: true});
  await expect(approve).toBeVisible();
  await expect(approve).toBeDisabled();
  await expect(approve).toHaveAccessibleDescription('Only the program manager can approve a supplier or schedule change. You are signed in as Cluster Administrator.');
  await expect(approval.getByLabel('Why is this the right call for the cluster?')).toHaveCount(0);
  await expect(approval.getByText('Approver: Priya Raman · Pending approval', {exact: true})).toBeVisible();
  await expect(approval.getByRole('article')).toHaveCount(0);
  const plan = page.locator('#site-plan');
  await expect(plan.getByText('Northwind Power · AGR-NW-2291', {exact: true})).toBeVisible();
  await expect(plan.getByText('15 May 2026', {exact: true})).toBeVisible();
  await page.goBack();
  await scenario.selectOption({label: 'Normal'});
  await expect(scenario.getByRole('option', {name: 'Normal'})).toHaveJSProperty('selected', true);
});

const restoreOpener = {name: 'Restore morning snapshot…', exact: true};
const restoreTitle = {name: 'Restore morning snapshot', exact: true};

for (const entry of ['Service health', 'account menu']) {
  test(`${entry} restore preserves edited evidence and uploads on Cancel and removes them on confirmation`, async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Continue as Elena Voss'}).click();
    await page.getByRole('link', {name: 'Open West Metro Cluster 4'}).click();
    const harbor = page.getByRole('table', {name: 'Site readiness register'}).getByRole('link', {name: 'Harbor Point', exact: true});
    await harbor.click();
    const evidence = page.getByRole('table', {name: 'Evidence matrix'});
    const power = evidence.getByRole('row').filter({has: page.getByRole('rowheader', {name: /^Power\b/})});
    const filename = 'restore-power-note.png';
    const upload = power.getByText(filename, {exact: true});
    const note = page.getByText('Temporary workshop power confirmation.', {exact: true});
    await expect(power.getByRole('cell', {name: 'Not Ready', exact: true})).toBeVisible();
    await power.getByLabel('Attach evidence to Power').setInputFiles({name: filename, mimeType: 'image/png', buffer: Buffer.from('workshop fixture')});
    await expect(upload).toBeVisible();
    await power.getByRole('button', {name: 'Update Power'}).click();
    const editor = page.getByRole('dialog', {name: 'Update Power evidence'});
    await editor.getByLabel('Status').selectOption('Ready');
    await editor.getByLabel('Evidence date and time').fill('2026-05-12T09:00');
    await editor.getByLabel('Note (optional)').fill('Temporary workshop power confirmation.');
    await editor.getByRole('button', {name: 'Save evidence'}).click();
    await expect(note).toBeVisible();
    const ready = power.getByRole('cell', {name: 'Ready', exact: true});
    await expect(ready).toBeVisible();

    await page.getByRole('button', {name: /Elena Voss Site Coordinator/}).click();
    await page.getByRole('button', {name: 'Switch user'}).click();
    await page.getByRole('button', {name: 'Samira Qureshi · Cluster Administrator', exact: true}).click();
    const account = page.getByRole('button', {name: /Samira Qureshi Cluster Administrator/});
    const health = page.getByRole('link', {name: 'Service health'});
    const scenario = page.getByLabel('Workshop scenario');
    const portfolio = page.getByRole('link', {name: 'Board', exact: true});
    const back = page.getByRole('link', {name: 'Back to Board', exact: true});
    const ddlDown = page.getByRole('button', {name: 'DDL · Down · synced 09:22'});
    await health.click();
    await scenario.selectOption({label: 'Service interruption'});
    await expect(ddlDown).toBeVisible();

    const dialog = page.getByRole('dialog', restoreTitle);
    const cancel = dialog.getByRole('button', {name: 'Cancel', exact: true});
    const healthOpener = page.getByRole('main').getByRole('button', restoreOpener);
    // Use the same opener for both cancellation and confirmation in each case.
    async function openRestore() {
      if (entry === 'account menu') {
        await account.click();
        await page.getByRole('region', {name: 'Account', exact: true}).getByRole('button', restoreOpener).click();
      } else {
        await healthOpener.click();
      }
    }

    if (entry === 'account menu') await portfolio.click();
    await openRestore();
    await expect(dialog).toHaveAccessibleDescription(/Restores all programs .* You stay signed in/);
    await expect(cancel).toBeFocused();
    if (entry === 'Service health') {
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(healthOpener).toBeFocused();
      await expect(ddlDown).toBeVisible();
      await openRestore();
    }
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(entry === 'account menu' ? account : healthOpener).toBeFocused();
    await expect(ddlDown).toBeVisible();
    if (entry === 'Service health') await portfolio.click();
    await harbor.click();
    await expect(ready).toBeVisible();
    await expect(note).toBeVisible();
    await expect(upload).toBeVisible();

    await back.click();
    if (entry === 'Service health') await health.click();
    await openRestore();
    await dialog.getByRole('button', restoreTitle).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Morning snapshot restored', {exact: true})).toBeVisible();
    await expect(account).toBeVisible();
    await expect(page.getByRole('button', {name: 'DDL · Up · synced 09:22'})).toBeVisible();
    if (entry === 'Service health') {
      await expect(scenario.getByRole('option', {name: 'Normal', exact: true})).toHaveJSProperty('selected', true);
      await portfolio.click();
    }
    await expect(page.getByRole('heading', {name: 'West Metro Cluster 4', level: 1})).toBeVisible();
    await harbor.click();
    await expect(page.getByRole('heading', {name: 'Harbor Point is Critical. Hold the 18 May crew. Power is not ready.', level: 1})).toBeVisible();
    await expect(power.getByRole('cell', {name: 'Not Ready', exact: true})).toBeVisible();
    await expect(ready).toHaveCount(0);
    await expect(note).toHaveCount(0);
    await expect(upload).toHaveCount(0);
  });
}

test('Samira restores a locked board and stays signed in', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Samira Qureshi'}).click();
  const account = page.getByRole('button', {name: /Samira Qureshi/});
  await expect(account).toBeVisible();

  // Inject a corrupt document record to exercise genuine locked-board recovery after reload.
  await page.evaluate(() => localStorage.setItem('nro.demo.uploads', '{broken'));
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Board unavailable'})).toBeVisible();
  await page.getByRole('button', restoreOpener).click();
  await page.getByRole('dialog', restoreTitle).getByRole('button', restoreTitle).click();
  await expect(page.getByText('Morning snapshot restored', {exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Programs', level: 1})).toBeVisible();
  await expect(account).toBeVisible();
});

test('a viewer cannot restore a locked board', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Jordan Ellis'}).click();
  await expect(page.getByRole('heading', {name: 'Programs', level: 1})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Service health'})).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('nro.demo.uploads', '{broken'));
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Board unavailable'})).toBeVisible();
  await expect(page.getByRole('button', {name: /Restore morning snapshot/})).toHaveCount(0);
});

test('thresholds relabel the register and block approved dispatch without replacing the recorded score', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Samira Qureshi'}).click();
  await page.getByRole('link', {name: 'Service health'}).click();
  const field = page.getByRole('spinbutton', {name: 'Good probability (%)'});
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('nro.demo.sites')).value['NRO-W-1847'].assessment);
  await expect(field).toHaveValue('80');
  const dispatchFloor = page.getByRole('spinbutton', {name: 'Dispatch minimum confidence (%)'});
  await expect(dispatchFloor).toHaveValue('60');
  await field.fill('95');
  await dispatchFloor.fill('91');
  await page.getByRole('button', {name: 'Save thresholds'}).click();
  await expect(page.getByText('Thresholds saved. No new assessment was run.')).toBeVisible();
  await page.getByRole('link', {name: 'Board', exact: true}).click();
  const civic = page.getByRole('row').filter({has: page.getByRole('link', {name: 'Civic Center', exact: true})});
  await expect(civic).toContainText('Needs Attention');
  await expect(civic).toContainText('92%');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('nro.demo.sites')).value['NRO-W-1847'].assessment);
  expect(after).toEqual(before);
  await page.getByRole('button', {name: /Samira Qureshi Cluster Administrator/}).click();
  await page.getByRole('button', {name: 'Switch user'}).click();
  await page.getByRole('button', {name: /^Andre Cole ·/}).click();
  await page.getByRole('link', {name: 'Open West Metro Cluster 4'}).click();
  await civic.getByRole('link', {name: 'Civic Center'}).click();
  const dispatch = page.getByRole('button', {name: 'Dispatch crew'});
  await expect(dispatch).toBeDisabled();
  await expect(dispatch).toHaveAccessibleDescription('Confidence is 90%. Dispatch requires at least 91% confidence.');
});

test('Priya is returned to Programs when she opens the Health URL directly', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Priya Raman'}).click();
  await expect(page.getByRole('link', {name: 'Service health'})).toHaveCount(0);
  await page.goto('/service-health');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', {name: 'Programs', level: 1})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Service health'})).toHaveCount(0);
});
