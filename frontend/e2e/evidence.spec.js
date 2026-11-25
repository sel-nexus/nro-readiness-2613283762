/** Exercise visible evidence, provenance links and historical score retention. */
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

test('Operator replays Harbor Point, follows a factor, attaches a document and retains history after an edit', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Elena Voss'}).click();
  await page.goto('/sites/NRO-W-1842?tab=prediction');
  const prediction = page.getByRole('region', {name: 'Assessment prediction'});
  await expect(prediction.getByText('+46 points')).toBeVisible();
  await prediction.getByRole('button', {name: 'Run assessment'}).click();
  await expect(prediction.getByText('Scoring…')).toBeVisible();
  await expect(prediction.getByText('Assessment complete. Probability 34%.')).toBeVisible();
  await expect(prediction.getByText(/corr_1842_r1/)).toBeVisible();
  await prediction.getByRole('link', {name: 'Power Not Ready'}).click();
  await expect(page).toHaveURL(/tab=evidence#evidence-Power$/);
  const table = page.getByRole('table', {name: 'Evidence matrix'});
  await expect(table.getByRole('row')).toHaveCount(7);
  await expect(table.getByText('Ingested: No timestamp').filter({visible: true})).toBeVisible();
  await table.getByLabel('Attach evidence to Power').setInputFiles({name: 'site-scan.png', mimeType: 'image/png', buffer: Buffer.from('test metadata')});
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
});

test('Viewer sees both disputed sources and missing evidence but cannot edit or score', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Continue as Jordan Ellis'}).click();
  await page.goto('/sites/NRO-W-1855?tab=evidence');
  await expect(page.getByText('DPAM and DDL disagree on material. Resolve with Omar Shah before relying on this score.')).toBeVisible();
  await page.getByText('DPAM and DDL', {exact: true}).click();
  await expect(page.getByText('DPAM · Ready · 11 May 2026 10:15')).toBeVisible();
  await expect(page.getByText('DDL · Not Ready · 11 May 2026 16:40')).toBeVisible();
  const update = page.getByRole('button', {name: 'Update Material'});
  await update.focus();
  await expect(update).toHaveAccessibleDescription('Only Operators can update evidence.');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/sites/NRO-W-1872?tab=prediction');
  await expect(page.getByRole('region', {name: 'Assessment prediction'})).toContainText('Confidence: 62%');
  await expect(page.getByRole('button', {name: 'Run assessment'})).toHaveCount(0);
  await page.getByRole('tab', {name: 'Evidence'}).click();
  await expect(page.getByText('Transmission has no evidence. The probability is Unavailable.')).toBeVisible();
});
