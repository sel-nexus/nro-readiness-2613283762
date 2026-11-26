/** Exercise visible evidence, provenance links and historical score retention. */
import {expect, test} from '@playwright/test';

const POWER_TEXT = 'Northwind Power. Commercial power not available. Next crew window 15 May 2026. Agreement AGR-NW-2291.';

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

test('Operator replays Harbor Point, follows a factor, attaches a document and retains history after an edit', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Elena Voss'}).click();
  await page.getByRole('link', {name: 'Open West Metro Cluster 4'}).click();
  await page.getByRole('link', {name: 'Review Harbor Point'}).click();
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Harbor Point is Critical. Hold the 18 May crew. Power is not ready.');
  await page.getByRole('tab', {name: 'Prediction'}).click();
  const prediction = page.getByRole('region', {name: 'Assessment prediction'});
  await expect(prediction.getByText('34%', {exact: true})).toHaveCSS('color', 'rgb(0, 130, 240)');
  await expect(prediction.getByText('Chance ready on 18 May 2026.')).toBeVisible();
  await expect(prediction.getByText('Assessment horizon: 6 days')).toBeVisible();
  await expect(prediction.getByText('Power status is a single supplier update. The score does not estimate utility duration past Ruth’s window.')).toBeVisible();
  await expect(prediction.getByText('+46 points')).toBeVisible();
  await prediction.getByRole('button', {name: 'Run assessment'}).click();
  await expect(prediction.getByText('Scoring…')).toBeVisible();
  await expect(prediction.getByText('Assessment complete. Probability 34%.')).toBeVisible();
  await expect(prediction.getByText(/corr_1842_r1/)).toBeVisible();
  await prediction.getByRole('link', {name: 'View evidence: Power Not Ready'}).click();
  await expect(page).toHaveURL(/tab=evidence#evidence-Power$/);
  const table = page.getByRole('table', {name: 'Evidence matrix'});
  await expect(table.getByRole('row')).toHaveCount(7);
  await expect(table.getByRole('columnheader', {name: 'Dependency'})).toBeVisible();
  await expect(table.getByText('Depends on the Northwind window. Blocks the 18 May crew.')).toBeVisible();
  await expect(table.getByText('Northwind Power feed', {exact: true})).toBeFocused();
  await expect(table.getByText('Ingested: No timestamp').filter({visible: true})).toBeVisible();
  const attach = table.getByLabel('Attach evidence to Power');
  const audit = page.getByRole('tab', {name: /^Audit/});
  const auditLabel = await audit.innerText();
  await attach.setInputFiles({name: 'rejected.txt', mimeType: 'text/plain', buffer: Buffer.from('not an attachment')});
  await expect(page.getByText('Choose a PDF, PNG or JPG file with a matching file type.')).toBeVisible();
  await expect(table.getByText('rejected.txt')).toHaveCount(0);
  await expect(audit).toHaveText(auditLabel);
  await page.getByRole('button', {name: 'Dismiss', exact: true}).click();

  await attach.setInputFiles({name: 'harbor-point-power-note.pdf', mimeType: 'application/pdf', buffer: Buffer.from('metadata')});
  const addedPdf = table.locator('details').filter({hasText: '8 bytes · application/pdf · Elena Voss'});
  await addedPdf.getByText('harbor-point-power-note.pdf', {exact: true}).click();
  await expect(addedPdf.getByText(POWER_TEXT, {exact: true})).toBeVisible();

  await attach.setInputFiles({name: 'site-scan.png', mimeType: 'image/png', buffer: Buffer.from('test metadata')});
  await expect(table.getByText('site-scan.png')).toBeVisible();
  await expect(table.getByText(/Couldn’t read text from this file/)).toBeVisible();
  await table.getByRole('button', {name: 'Update Power'}).click();
  const drawer = page.getByRole('dialog', {name: 'Update Power evidence'});
  await drawer.getByLabel('Status').selectOption('Ready');
  await drawer.getByLabel('Evidence date and time').fill('2026-05-12T09:00');
  await drawer.getByLabel('Note (optional)').fill('Power window confirmed.');
  await drawer.getByRole('button', {name: 'Save evidence'}).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByText('Evidence changed. Run assessment to rescore.')).toBeVisible();
  await expect(page.getByText('Power window confirmed.')).toBeVisible();
  await page.getByRole('tab', {name: 'Prediction'}).click();
  await expect(prediction.getByRole('heading', {name: 'Last score · Historical'})).toBeVisible();
  await prediction.getByRole('button', {name: 'Run assessment'}).click();
  await expect(prediction.getByRole('status').filter({hasText: 'No supported assessment matches these inputs.'})).toBeVisible();
  await expect(prediction.getByText(/corr_1842_r1/)).toBeVisible();

  await audit.click();
  const history = page.getByRole('region', {name: 'Audit', exact: true});
  const replay = history.locator('details').filter({has: page.getByText('snap_1842_r1', {exact: true})});
  await replay.getByText(/^Scored · 12 May 2026 09:40/).click();
  await replay.getByText('Assessed prerequisite snapshot', {exact: true}).click();
  await expect(replay.getByText(/^Power · Not Ready · Current ·/)).toBeVisible();
  await page.getByRole('tab', {name: 'Evidence'}).click();
  await page.reload();
  await expect(table.getByRole('row').filter({has: page.getByRole('rowheader', {name: /Power/})}).getByRole('cell', {name: 'Ready', exact: true})).toBeVisible();
  await expect(page.getByText('Power window confirmed.')).toBeVisible();
  await expect(table.getByText('site-scan.png')).toBeVisible();
  await expect(table.getByText('rejected.txt')).toHaveCount(0);
  await addedPdf.getByText('harbor-point-power-note.pdf', {exact: true}).click();
  await expect(addedPdf.getByText(POWER_TEXT, {exact: true})).toBeVisible();
});

test('Viewer sees both disputed sources and missing evidence but cannot edit or score', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Jordan Ellis'}).click();
  await page.getByRole('link', {name: 'Open West Metro Cluster 4'}).click();
  const register = page.getByRole('table', {name: 'Site readiness register'});
  await register.getByRole('link', {name: 'Market DAS', exact: true}).click();
  await expect(page.getByText('DPAM and DDL disagree on material. Resolve with Omar Shah before relying on this score.')).toBeVisible();
  await page.getByText('DPAM and DDL', {exact: true}).click();
  await expect(page.getByText('DPAM · Ready · 11 May 2026 10:15')).toBeVisible();
  await expect(page.getByText('DDL · Not Ready · 11 May 2026 16:40')).toBeVisible();
  const update = page.getByRole('button', {name: 'Update Material'});
  await update.focus();
  await expect(update).toHaveAccessibleDescription('Only Operators can update evidence.');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', {name: 'Back to Board'}).click();
  await register.getByRole('link', {name: 'East Yard', exact: true}).click();
  const evidence = page.getByRole('tab', {name: 'Evidence'});
  const prediction = page.getByRole('tab', {name: 'Prediction'});
  await evidence.focus();
  await page.keyboard.press('ArrowRight');
  await expect(prediction).toBeFocused();
  await expect(prediction).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/sites\/NRO-W-1872\?tab=prediction$/);
  await expect(page.getByRole('region', {name: 'Assessment prediction'})).toContainText('Confidence: 62%');
  await expect(page.getByRole('button', {name: 'Run assessment'})).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', {name: /^Audit/})).toBeFocused();
  await expect(page).toHaveURL(/tab=audit$/);
  await page.keyboard.press('Home');
  await expect(evidence).toBeFocused();
  await expect(evidence).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Transmission has no evidence. The probability is Unavailable.')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('tabpanel', {name: /^Audit/})).toBeVisible();
  await expect(page).toHaveURL(/tab=audit$/);
  await page.goBack();
  await expect(page.getByRole('tabpanel', {name: 'Prediction'})).toContainText('Confidence: 62%');
  await expect(page).toHaveURL(/tab=prediction$/);
  await page.goForward();
  await expect(page.getByRole('tabpanel', {name: /^Audit/})).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('tabpanel', {name: 'Evidence'})).toContainText('Transmission has no evidence. The probability is Unavailable.');
});

test('Dispatcher sees the Harbor Point hold and can inspect a healthy site without dispatching either', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Andre Cole'}).click();
  await page.getByRole('link', {name: 'Open West Metro Cluster 4'}).click();
  await page.getByRole('link', {name: 'Review Harbor Point'}).click();
  await page.getByRole('tab', {name: 'Blockers and action'}).click();
  const dispatch = page.getByRole('button', {name: 'Dispatch crew'});
  await expect(dispatch).toBeDisabled();
  await expect(dispatch).toHaveAccessibleDescription('Power is Not Ready and the site is on hold.');
  await expect(page.getByRole('button', {name: 'Hold crew'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Resequence', exact: true})).toBeDisabled();
  await page.getByRole('link', {name: 'Back to Board'}).click();
  await page.getByRole('table', {name: 'Site readiness register'}).getByRole('link', {name: 'Rockridge', exact: true}).click();
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Rockridge is Good. Check the crew plan before dispatch.');
  await page.getByRole('tab', {name: 'Prediction'}).click();
  const prediction = page.getByRole('region', {name: 'Assessment prediction'});
  await expect(prediction.getByText('86%', {exact: true})).toBeVisible();
  await expect(prediction.getByText('Chance ready on 14 May 2026.')).toBeVisible();
  await expect(prediction.getByRole('button', {name: 'Run assessment'})).toBeEnabled();
});
