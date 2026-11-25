/** Exercise visible decisions, persona handoffs, field confirmation and site history. */
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

/** Enter the board in a fresh browser context. */
async function enter(page, name) {
  await page.goto('/');
  await page.getByRole('button', {name: `Continue as ${name}`}).click();
  await expect(page.getByRole('heading', {name: 'West Metro Cluster 4'})).toBeVisible();
}

/** Use the real account handoff instead of writing browser session records. */
async function handoff(page, from, to) {
  await page.getByRole('button', {name: from, exact: true}).click();
  await page.getByRole('button', {name: 'Switch user'}).click();
  await page.getByRole('button', {name: to, exact: true}).click();
  await expect(page.getByRole('heading', {name: 'West Metro Cluster 4'})).toBeVisible();
}

test('Priya approves only the Portside supplier and date; Andre inherits the plan, not dispatch authority', async ({page}) => {
  await enter(page, 'Priya Raman');
  await page.goto('/sites/NRO-W-1866?tab=approval');
  const approval = page.getByRole('region', {name: 'Approval'});
  const plan = page.locator('#site-plan');
  await expect(plan).toContainText('Northwind Power · AGR-NW-2291');
  await expect(plan).toContainText('15 May 2026');
  await expect(approval).toContainText('Civic Civil');
  await expect(approval).toContainText('AGR-CC-1844');
  await expect(approval).toContainText('Commercial terms on file.');
  await approval.getByRole('button', {name: 'Approve', exact: true}).click();
  await expect(approval.getByRole('alert')).toContainText('at least 12 characters');
  await approval.getByLabel('Why is this the right call for the cluster?').fill('Civic Civil can take the pad in the confirmed window.');
  await approval.getByRole('button', {name: 'Approve', exact: true}).click();
  await expect(approval.getByRole('heading', {name: 'Approved — resequence'})).toBeVisible();
  await expect(page.getByText('Approved — resequence by Priya Raman. ECO-1866-1 queued locally.')).toBeVisible();
  await expect(plan).toContainText('19 May 2026');
  await handoff(page, 'Priya Raman Program Manager', 'Andre Cole · Field Dispatcher');
  await page.goto('/sites/NRO-W-1866?tab=action');
  await expect(plan).toContainText('Civic Civil · AGR-CC-1844');
  const field = page.getByRole('region', {name: 'Field execution'});
  await expect(field).toContainText('15 May 2026 07:00');
  await expect(field.getByRole('button', {name: 'Dispatch crew'})).toBeDisabled();
  await page.getByRole('tab', {name: /^Audit/}).click();
  await page.getByText(/^Approval ·/).click();
  await page.getByText('Assessed prerequisite snapshot', {exact: true}).filter({visible: true}).click();
  await expect(page.getByText('Power · In progress · Current · Northwind Power feed')).toBeVisible();
});

test('Jordan intentionally records a denial without a rationale or any supplier change', async ({page}) => {
  await enter(page, 'Jordan Ellis');
  await page.goto('/sites/NRO-W-1866?tab=approval');
  const approve = page.getByRole('button', {name: 'Approve', exact: true});
  await expect(approve).toBeDisabled();
  await expect(approve).toHaveAccessibleDescription('Only the program manager can approve a supplier or schedule change. You are signed in as Regional Viewer.');
  await expect(page.getByLabel('Why is this the right call for the cluster?')).toHaveCount(0);
  await page.getByRole('button', {name: 'Record denied approval attempt'}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('tab', {name: /^Audit/}).click();
  const denial = page.getByText(/^Approval denied ·/);
  await expect(denial).toHaveCount(1);
  await denial.click();
  await expect(page.getByText('Actor ID: NRO-E-10425 · Attempted action: approve · Reason: FORBIDDEN')).toBeVisible();
  await expect(page.locator('#site-plan')).toContainText('Northwind Power');
});

test('Andre sees held and unconfirmed crews and dispatches Civic Center only after confirming', async ({page}) => {
  await enter(page, 'Andre Cole');
  const field = page.getByRole('region', {name: 'Field execution'});
  await page.goto('/sites/NRO-W-1860?tab=action');
  for (const name of ['Dispatch crew', 'Hold crew', 'Resequence']) {
    await expect(field.getByRole('button', {name, exact: true})).toBeDisabled();
    await expect(field.getByRole('button', {name, exact: true})).toHaveAccessibleDescription('Confidence is 48%. An approver has to review this site before dispatch.');
  }
  await page.goto('/sites/NRO-W-1891?tab=action');
  await expect(field).toContainText('Helen Cho');
  await expect(field).toContainText('26 May 2026 07:00');
  await expect(field.getByRole('button', {name: 'Hold crew'})).toHaveAttribute('aria-pressed', 'true');
  await expect(field).toContainText('Power is Not Ready after the 8 May failed visit.');
  await page.goto('/sites/NRO-W-1847?tab=action');
  const dispatch = field.getByRole('button', {name: 'Dispatch crew'});
  await dispatch.click();
  const dialog = page.getByRole('dialog', {name: 'Confirm dispatch crew'});
  await expect(dialog).toContainText('Dispatch Luis Ortega’s crew of 4 to Civic Center on 16 May 2026 at 07:00. This does not change the supplier or the baseline date.');
  await dialog.getByRole('button', {name: 'Cancel'}).click();
  await expect(dispatch).toBeFocused();
  await dispatch.click();
  await dialog.getByRole('button', {name: 'Confirm', exact: true}).click();
  await expect(field).toContainText('Crew status: Dispatched');
  await expect(dispatch).toBeDisabled();
  await page.getByRole('tab', {name: /^Audit/}).click();
  const dispatched = page.getByText(/^Dispatched ·/);
  await expect(dispatched).toHaveCount(1);
  await dispatched.click();
  await expect(page.getByText('snap_1847_0511', {exact: true}).filter({visible: true})).toBeVisible();
  await expect(page.getByText('Working evidence revision at execution')).toBeVisible();
});

test('Operator records a local Lakeside follow-up; Harbor alternatives navigate without writing', async ({page}) => {
  await enter(page, 'Elena Voss');
  await page.goto('/sites/NRO-W-1842?tab=action');
  const ranked = page.getByRole('list', {name: 'Ranked prerequisites'});
  await expect(ranked.getByRole('listitem')).toHaveCount(1);
  await expect(ranked).toContainText('Ruth Ibarra');
  await expect(ranked).toContainText('15 May if the cutover holds');
  const auditTab = page.getByRole('tab', {name: /^Audit/});
  const before = await auditTab.textContent();
  await expect(page.getByRole('button', {name: 'Apply precautionary hold'})).toBeDisabled();
  await page.getByRole('link', {name: 'Resequence now to North Gate’s spare crew on 21 May'}).click();
  await expect(page.getByRole('region', {name: 'Approval'})).toContainText('21 May 2026');
  await expect(auditTab).toHaveText(before);
  await page.goto('/sites/NRO-W-1851?tab=action');
  await page.getByRole('button', {name: 'Assign indicated owner'}).click();
  await page.getByRole('button', {name: 'Request evidence refresh'}).click();
  await page.getByRole('button', {name: 'Apply precautionary hold'}).click();
  await expect(page.locator('#site-plan')).toContainText('Hold · Denise Park');
  await auditTab.click();
  for (const verb of ['Recommended', 'Owner assigned', 'Evidence refresh requested', 'Precautionary hold']) {
    await expect(page.getByText(new RegExp(`^${verb} ·`))).toHaveCount(1);
  }
});

for (const action of ['Reject', 'Modify', 'Override']) {
  test(`Priya records ${action.toLowerCase()} with rationale and without changing the supplier or baseline`, async ({page}) => {
    await enter(page, 'Priya Raman');
    await page.goto(`/sites/${action === 'Override' ? 'NRO-W-1842' : 'NRO-W-1866'}?tab=approval`);
    const plan = page.locator('#site-plan');
    await page.getByLabel('Why is this the right call for the cluster?').fill('Leave the baseline in place while power is verified.');
    await page.getByRole('button', {name: action, exact: true}).click();
    if (action === 'Modify') {
      await page.getByLabel('Owner', {exact: true}).selectOption({label: 'Ruth Ibarra'});
      await page.getByLabel('Due date').fill('2026-05-14');
      await page.getByLabel('Short note').fill('Verify the supplier window.');
      await page.getByRole('button', {name: 'Save modification'}).click();
      await expect(page.getByText(/Ruth Ibarra · 14 May 2026 · Verify the supplier window/)).toBeVisible();
    }
    await expect(plan).toContainText('Northwind Power · AGR-NW-2291');
    await expect(plan).toContainText(action === 'Override' ? '18 May 2026' : '15 May 2026');
    await page.getByRole('tab', {name: /^Audit/}).click();
    await expect(page.getByText(new RegExp(`^${{Reject: 'Rejected', Modify: 'Modified', Override: 'Override'}[action]} ·`))).toHaveCount(1);
  });
}
