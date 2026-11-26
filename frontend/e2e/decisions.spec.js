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

/** Sign in and open a named program Board from Programs. */
async function enter(page, name, program = 'West Metro Cluster 4') {
  await page.goto('/');
  await page.getByRole('button', {name: `Continue as ${name}`}).click();
  await openBoard(page, program);
}

/** Confirm the landing page before following the real Board link. */
async function openBoard(page, program) {
  await expect(page.getByRole('heading', {name: 'Programs', exact: true, level: 1})).toBeVisible();
  await page.getByRole('link', {name: `Open ${program}`, exact: true}).click();
  await expect(page.getByRole('heading', {name: program, exact: true, level: 1})).toBeVisible();
}

/** Use the real account handoff instead of writing browser session records. */
async function handoff(page, from, to) {
  await page.getByRole('button', {name: from, exact: true}).click();
  await page.getByRole('button', {name: 'Switch user'}).click();
  await page.getByRole('button', {name: to, exact: true}).click();
  await openBoard(page, 'West Metro Cluster 4');
}

/** Filter the portfolio, then follow the site's actual register link. */
async function fromPortfolio(page, name, id, tab) {
  await page.getByRole('combobox', {name: 'Search site id or name'}).fill(id);
  await page.getByRole('table', {name: 'Site readiness register'}).getByRole('link', {name, exact: true}).click();
  await expect(page).toHaveURL(`/sites/${id}`);
  await expect(page.getByRole('heading', {name: new RegExp(`^${name} is .+\\.$`), level: 1})).toBeVisible();
  await page.getByRole('tab', {name: tab, exact: true}).click();
}

/** Open the matching site with the workspace search keyboard controls. */
async function fromWorkspace(page, id, tab) {
  const lookup = page.getByRole('combobox', {name: 'Search site id or name'});
  await lookup.fill(id);
  await expect(page.getByRole('option', {name: new RegExp(id)})).toBeVisible();
  await lookup.press('Enter');
  await expect(page).toHaveURL(`/sites/${id}`);
  await page.getByRole('tab', {name: tab, exact: true}).click();
}

const ACTION = 'Blockers and action';

test('East Bay decisions are scoped, and a Marsh Junction approval links to its own audit', async ({page}) => {
  await enter(page, 'Priya Raman', 'East Bay Cluster 2');
  await page.getByRole('link', {name: 'Approvals', exact: true}).click();
  await expect(page).toHaveURL('/approvals?program=east-bay');
  const marsh = page.getByRole('region', {name: 'Marsh Junction'});
  await expect(marsh).toContainText('NRO-E-2102');
  await expect(page.getByRole('region', {name: 'Portside'})).toHaveCount(0);
  const rationale = 'Confirm the independent East Bay supplier and proposed installation date.';
  await marsh.getByLabel('Why is this the right call for the cluster?').fill(rationale);
  await marsh.getByRole('button', {name: 'Approve', exact: true}).click();
  await expect(page.getByText('No records for this program.')).toBeVisible();
  await fromWorkspace(page, 'NRO-E-2102', 'Approval');
  await expect(page.locator('#site-plan')).toContainText('22 May 2026');
  await page.getByRole('tab', {name: /^Audit/}).click();
  const event = page.getByRole('region', {name: 'Audit'}).locator('ol > li').filter({hasText: /^Approval ·/});
  await event.locator('summary').click();
  for (const value of ['ECO-2102-1', 'snap_NRO-E-2102_seed', 'nro-readiness-sim 1.4.2', 'Approved — resequence',
    `Rationale: ${rationale}`, 'Priya Raman', '12 May 2026 09:40']) {
    await expect(event.getByText(value, {exact: true})).toBeVisible();
  }
  await expect(event).not.toContainText('corr_NRO-E-2102_seed');
  await page.getByRole('combobox', {name: 'Active program'}).selectOption('west-metro');
  await page.getByRole('link', {name: 'Approvals', exact: true}).click();
  await expect(page).toHaveURL('/approvals');
  await expect(page.getByRole('region', {name: 'Portside'})).toBeVisible();
  await expect(marsh).toHaveCount(0);
});

test('a Viewer sees disabled decision controls beside the East Bay request', async ({page}) => {
  await enter(page, 'Jordan Ellis', 'East Bay Cluster 2');
  await page.getByRole('link', {name: 'Approvals', exact: true}).click();
  const marsh = page.getByRole('region', {name: 'Marsh Junction'});
  for (const name of ['Approve', 'Reject', 'Modify']) {
    const button = marsh.getByRole('button', {name, exact: true});
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription(/Only the program manager.*Regional Viewer/);
  }
});

test('Priya approves only the Portside supplier and date; Andre inherits the plan, not dispatch authority', async ({page}) => {
  await enter(page, 'Priya Raman');
  await fromPortfolio(page, 'Portside', 'NRO-W-1866', ACTION);
  await page.getByRole('link', {name: 'Review in Approval', exact: true}).click();
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
  await fromPortfolio(page, 'Portside', 'NRO-W-1866', ACTION);
  await expect(plan).toContainText('Civic Civil · AGR-CC-1844');
  const field = page.getByRole('region', {name: 'Field execution'});
  await expect(field).toContainText('15 May 2026 07:00');
  await expect(field.getByRole('button', {name: 'Dispatch crew'})).toBeDisabled();
  await page.getByRole('tab', {name: /^Audit/}).click();
  const event = page.getByRole('region', {name: 'Audit'}).locator('ol > li').filter({has: page.locator('summary').filter({hasText: /^Approval ·/})});
  await expect(event).toHaveCount(1);
  await event.locator('summary').filter({hasText: /^Approval ·/}).click();
  await event.getByText('Assessed prerequisite snapshot', {exact: true}).click();
  await expect(event.getByText('Power · In progress · Current · Northwind Power feed', {exact: true})).toBeVisible();
});

test('Jordan intentionally records a denial without a rationale or any supplier change', async ({page}) => {
  await enter(page, 'Jordan Ellis');
  await fromPortfolio(page, 'Portside', 'NRO-W-1866', 'Approval');
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
  await fromPortfolio(page, 'Harbor Point', 'NRO-W-1842', ACTION);
  await page.getByRole('tab', {name: 'Prediction', exact: true}).click();
  const prediction = page.getByRole('region', {name: 'Assessment prediction'});
  await expect(prediction.getByText('34%', {exact: true})).toBeVisible();
  await expect(prediction.getByText('Confidence: 86% · High', {exact: true})).toBeVisible();
  await expect(prediction.getByText('Evidence is complete enough to rank the blocker. It is not enough to dispatch through a failed prerequisite.', {exact: true})).toBeVisible();
  await page.getByRole('tab', {name: /^Audit/}).click();
  await expect(page.getByRole('region', {name: 'Audit'}).getByText(/^Dispatched ·/)).toHaveCount(0);
  await page.getByRole('tab', {name: ACTION, exact: true}).click();
  await expect(field.getByText('Crew status: Hold', {exact: true})).toBeVisible();
  await expect(field.getByRole('button', {name: 'Hold crew', pressed: true})).toBeDisabled();
  await expect(field.getByRole('button', {name: 'Dispatch crew'})).toBeDisabled();
  await expect(field.getByRole('button', {name: 'Dispatch crew'})).toHaveAccessibleDescription('Power is Not Ready and the site is on hold.');
  await expect(field).toContainText('18 May 2026 07:00');
  await expect(field.getByRole('button', {name: 'Resequence', exact: true})).toBeDisabled();
  await field.getByRole('link', {name: 'Review resequence in Approval'}).click();
  const spareApproval = page.getByRole('region', {name: 'Approval'});
  await expect(spareApproval).toContainText('Proposed crew slot: Luis Ortega · Crew of 4 · 21 May 2026 07:00');
  await expect(spareApproval.getByRole('button', {name: 'Approve', exact: true})).toBeDisabled();

  await fromWorkspace(page, 'NRO-W-1860', ACTION);
  for (const name of ['Dispatch crew', 'Hold crew', 'Resequence']) {
    await expect(field.getByRole('button', {name, exact: true})).toBeDisabled();
    await expect(field.getByRole('button', {name, exact: true})).toHaveAccessibleDescription('Confidence is 48%. An approver has to review this site before dispatch.');
  }
  await fromWorkspace(page, 'NRO-W-1891', ACTION);
  await expect(field).toContainText('Helen Cho');
  await expect(field).toContainText('26 May 2026 07:00');
  await expect(field.getByRole('button', {name: 'Hold crew'})).toHaveAttribute('aria-pressed', 'true');
  await expect(field).toContainText('Power is Not Ready after the 8 May failed visit.');
  await fromWorkspace(page, 'NRO-W-1847', ACTION);
  await expect(page.locator('#site-plan')).toContainText('92% · 90% (High)');
  const auditTab = page.getByRole('tab', {name: /^Audit/});
  await auditTab.click();
  const civicAudit = page.getByRole('region', {name: 'Audit'});
  await expect(civicAudit.getByText(/^Scored ·/)).toHaveCount(2);
  for (const [scoredAt, snapshotId] of [['11 May 2026 15:40', 'snap_1847_0511'], ['12 May 2026 09:34', 'snap_1847_0934']]) {
    const summary = `Scored · ${scoredAt} · Assessment model`;
    const entry = civicAudit.getByRole('listitem').filter({has: page.getByText(summary, {exact: true})});
    await entry.getByText(summary, {exact: true}).click();
    await expect(entry.getByText(snapshotId, {exact: true})).toBeVisible();
    await expect(entry.getByText('92% · 90%', {exact: true})).toBeVisible();
    await expect(entry).not.toContainText('nro-readiness-sim');
    await expect(entry).not.toContainText('corr_');
  }
  await page.getByRole('tab', {name: ACTION, exact: true}).click();
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
  const dispatched = civicAudit.locator('ol > li > details > summary').filter({hasText: /^Dispatched ·/});
  await expect(dispatched).toHaveCount(1);
  await dispatched.click();
  await expect(page.getByText('snap_1847_0511', {exact: true}).filter({visible: true})).toBeVisible();
  await expect(page.getByText('Working evidence revision at execution')).toBeVisible();
});

test('Andre confirms an eligible Civic Center hold without changing the crew, shift or plan', async ({page}) => {
  await enter(page, 'Andre Cole');
  await fromPortfolio(page, 'Civic Center', 'NRO-W-1847', ACTION);
  const field = page.getByRole('region', {name: 'Field execution'});
  const hold = field.getByRole('button', {name: 'Hold crew', exact: true});
  const dispatch = field.getByRole('button', {name: 'Dispatch crew', exact: true});
  const plan = page.locator('#site-plan');
  // Read committed records without modifying them; the UI does not expose execution or assignment IDs.
  const readCommitted = () => page.evaluate(() => {
    const read = key => JSON.parse(localStorage.getItem(`nro.demo.${key}`)).value;
    const id = 'NRO-W-1847';
    const {plan, planRev, executions} = read('sites')[id];
    const {state, rev, ...assignment} = read('program').crew.find(item => item.siteId === id);
    return {plan, planRev, executions, state, rev, assignment, events: read('audit').events.filter(event => event.siteId === id)};
  });
  await expect(hold).toBeEnabled();
  await expect(hold).toHaveAttribute('aria-pressed', 'false');
  await expect(dispatch).toBeEnabled();
  await expect(plan).toContainText('Civic Civil · AGR-CC-1844');
  await expect(plan).toContainText('16 May 2026');
  const before = await readCommitted();
  await hold.click();
  const dialog = page.getByRole('dialog', {name: 'Confirm hold crew', exact: true});
  await expect(dialog).toHaveAccessibleDescription('Hold Luis Ortega’s crew of 4 for Civic Center on 16 May 2026 at 07:00. The crew, shift, supplier and baseline date stay unchanged.');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Confirm', exact: true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(field.getByText('Crew status: Hold', {exact: true})).toBeVisible();
  await expect(hold).toHaveAttribute('aria-pressed', 'true');
  await expect(hold).toBeDisabled();
  await expect(dispatch).toBeDisabled();
  await expect(field).toContainText('Luis Ortega');
  await expect(field).toContainText('West Metro Yard');
  await expect(field).toContainText('16 May 2026 07:00');
  await expect(plan).toContainText('Civic Civil · AGR-CC-1844');
  await expect(plan).toContainText('16 May 2026');

  const after = await readCommitted();
  expect(after.assignment).toEqual(before.assignment);
  expect(after.rev).toBe(before.rev + 1);
  expect(after.state).toBe('Hold');
  expect(after.plan).toEqual(before.plan);
  expect(after.planRev).toBe(before.planRev);
  expect(before.executions).toEqual([]);
  expect(after.executions).toEqual([expect.objectContaining({action: 'hold', assignmentId: before.assignment.id, actorId: 'NRO-E-10424'})]);
  expect(after.events).toEqual([...before.events, expect.objectContaining({verb: 'Disposition', executionId: after.executions[0].id, actorId: 'NRO-E-10424'})]);

  await page.getByRole('tab', {name: /^Audit/}).click();
  const audit = page.getByRole('region', {name: 'Audit'});
  const event = audit.getByText(/^Disposition · .* · Andre Cole$/);
  await expect(event).toHaveCount(1);
  await event.click();
  await expect(audit.getByText('Crew hold recorded for Civic Center.', {exact: true})).toBeVisible();
  await expect(audit.getByText(/^Dispatched ·/)).toHaveCount(0);
});

test('Operator records a local Lakeside follow-up; Harbor alternatives navigate without writing', async ({page}) => {
  await enter(page, 'Elena Voss');
  await page.getByRole('link', {name: 'Review Harbor Point', exact: true}).click();
  await page.getByRole('tab', {name: ACTION, exact: true}).click();
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
  await fromWorkspace(page, 'NRO-W-1851', ACTION);
  await page.getByRole('button', {name: 'Assign indicated owner'}).click();
  await page.getByRole('button', {name: 'Request evidence refresh'}).click();
  await page.getByRole('button', {name: 'Apply precautionary hold'}).click();
  await expect(page.locator('#site-plan')).toContainText('Hold · Denise Park');
  await auditTab.click();
  for (const verb of ['Recommended', 'Owner assigned', 'Evidence refresh requested', 'Precautionary hold']) {
    await expect(page.getByText(new RegExp(`^${verb} ·`))).toHaveCount(1);
  }
});

test('Priya approves Harbor’s alternate slot and Andre records it without dispatching the held crew', async ({page}) => {
  await enter(page, 'Priya Raman');
  await fromPortfolio(page, 'Harbor Point', 'NRO-W-1842', ACTION);
  await page.getByRole('link', {name: 'Resequence now to North Gate’s spare crew on 21 May'}).click();
  const approval = page.getByRole('region', {name: 'Approval'});
  await expect(approval).toContainText('Proposed crew slot: Luis Ortega · Crew of 4 · 21 May 2026 07:00');
  await approval.getByLabel('Why is this the right call for the cluster?').fill('Reserve the spare slot while Harbor power is still blocked.');
  await approval.getByRole('button', {name: 'Approve', exact: true}).click();
  await expect(approval.getByRole('heading', {name: 'Approved — resequence'})).toBeVisible();
  await expect(page.locator('#site-plan')).toContainText('21 May 2026');

  await handoff(page, 'Priya Raman Program Manager', 'Andre Cole · Field Dispatcher');
  await fromPortfolio(page, 'Harbor Point', 'NRO-W-1842', ACTION);
  const field = page.getByRole('region', {name: 'Field execution'});
  const resequence = field.getByRole('button', {name: 'Resequence', exact: true});
  await expect(field).toContainText('18 May 2026 07:00');
  await expect(field.getByRole('button', {name: 'Dispatch crew'})).toBeDisabled();
  await expect(resequence).toBeEnabled();
  await resequence.click();
  const dialog = page.getByRole('dialog', {name: 'Confirm resequence'});
  await expect(dialog).toContainText('Luis Ortega, crew of 4, 21 May 2026 07:00');
  await expect(dialog).toContainText('This does not dispatch the crew or change the baseline date.');
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(field).toContainText('18 May 2026 07:00');
  await resequence.click();
  await dialog.getByRole('button', {name: 'Confirm', exact: true}).click();
  await expect(field).toContainText('21 May 2026 07:00');
  await expect(field).not.toContainText('18 May 2026 07:00');
  await expect(field).toContainText('Crew status: Hold');
  await expect(field.getByRole('button', {name: 'Dispatch crew'})).toBeDisabled();
  await expect(resequence).toBeDisabled();

  await page.getByRole('tab', {name: /^Audit/}).click();
  const audit = page.getByRole('region', {name: 'Audit'});
  const execution = audit.getByRole('listitem').filter({has: page.getByText(/^Disposition · .* · Andre Cole$/)});
  await expect(execution).toHaveCount(1);
  await execution.getByText(/^Disposition ·/).click();
  await expect(execution).toContainText('Crew resequence recorded for Harbor Point.');
  await expect(execution.getByText('snap_1842_0934', {exact: true})).toBeVisible();
  await expect(execution.getByText('Working evidence revision at execution')).toBeVisible();
  await expect(page.getByText(/^Dispatched ·/)).toHaveCount(0);
});

for (const action of ['Reject', 'Modify', 'Override']) {
  test(`Priya records ${action.toLowerCase()} with rationale and without changing the supplier or baseline`, async ({page}) => {
    await enter(page, 'Priya Raman');
    if (action === 'Override') await fromPortfolio(page, 'Harbor Point', 'NRO-W-1842', 'Approval');
    else await fromPortfolio(page, 'Portside', 'NRO-W-1866', 'Approval');
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
    const verb = new RegExp(`^${{Reject: 'Rejected', Modify: 'Modified', Override: 'Override'}[action]} ·`);
    await expect(page.getByRole('region', {name: 'Audit'}).locator('ol > li > details > summary').filter({hasText: verb})).toHaveCount(1);
  });
}
