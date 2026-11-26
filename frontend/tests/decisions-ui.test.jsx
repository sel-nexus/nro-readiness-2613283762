// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act, cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useSyncExternalStore} from 'react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import App from '../src/App.jsx';
import {ApprovalDraftScope, ApprovalPanel} from '../src/components/ApprovalPanel.jsx';
import {AuditPanel} from '../src/components/AuditPanel.jsx';
import {FieldStrip} from '../src/components/FieldStrip.jsx';
import {PERSON} from '../src/data/people.js';
import {BOARD_AT, MODEL} from '../src/data/register.js';
import SiteWorkspace from '../src/pages/SiteWorkspace.jsx';
import {runAssessment} from '../src/services/assessment.js';
import {continueAs, readAccess} from '../src/utils/access.js';
import {deriveReadiness} from '../src/utils/readiness.js';
import {createStore} from '../src/utils/storage.js';

const PORTSIDE = 'NRO-W-1866';
const CIVIC = 'NRO-W-1847';
const HARBOR = 'NRO-W-1842';
const MARSH = 'NRO-E-2102';
const REASON_LABEL = 'Why is this the right call for the cluster?';
const dialogPrototype = HTMLDialogElement.prototype;
const originalDialogMethods = ['showModal', 'close'].map(name => [name, Object.getOwnPropertyDescriptor(dialogPrototype, name)]);

beforeEach(() => {
  localStorage.clear();
  // jsdom lacks native modal opening/closing. Keep the rest of the interaction real.
  Object.defineProperties(dialogPrototype, {
    showModal: {configurable: true, value() { this.open = true; }},
    close: {configurable: true, value() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    }},
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  for (const [name, descriptor] of originalDialogMethods) {
    if (descriptor) Object.defineProperty(dialogPrototype, name, descriptor);
    else delete dialogPrototype[name];
  }
  localStorage.clear();
});

it.each([PERSON.elena, PERSON.andre, PERSON.jordan, PERSON.samira, PERSON.marcus])(
  'shows the East Bay queue but disables decisions for %s', async actorId => {
    const west = createStore(localStorage);
    expect(west.bootstrap().ok).toBe(true);
    expect(continueAs(west, actorId).ok).toBe(true);
    window.history.replaceState(null, '', '/approvals?program=east-bay');
    render(<App />);
    const request = within(await screen.findByRole('region', {name: 'Marsh Junction'}));
    for (const name of ['Approve', 'Reject', 'Modify']) {
      const action = request.getByRole('button', {name, exact: true});
      expect(action).toBeDisabled();
      expect(action).toHaveAccessibleDescription(/Only the program manager/);
    }
    expect(request.queryByRole('textbox', {name: REASON_LABEL})).not.toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Portside'})).not.toBeInTheDocument();
  },
);

it.each(['Approve', 'Reject', 'Modify'])('records %s in East Bay only, then removes the waiting item', async verb => {
  const west = createStore(localStorage);
  expect(west.bootstrap().ok).toBe(true);
  expect(continueAs(west, PERSON.priya).ok).toBe(true);
  const westBefore = west.getSnapshot().sites[PORTSIDE];
  window.history.replaceState(null, '', '/approvals?program=east-bay');
  const user = userEvent.setup();
  render(<App />);
  const request = within(await screen.findByRole('region', {name: 'Marsh Junction'}));
  expect(request.getByRole('link', {name: 'Open Marsh Junction approval'})).toHaveAttribute('href', `/sites/${MARSH}?tab=approval`);
  expect(screen.queryByRole('region', {name: 'Portside'})).not.toBeInTheDocument();
  const rationale = 'Review the new civil works window before scheduling this crew.';
  await user.type(request.getByRole('textbox', {name: REASON_LABEL}), rationale);
  await user.click(request.getByRole('button', {name: verb, exact: true}));
  if (verb === 'Modify') {
    await user.selectOptions(request.getByRole('combobox', {name: 'Owner'}), PERSON.ruth);
    fireEvent.change(request.getByLabelText('Due date'), {target: {value: '2026-05-17'}});
    await user.type(request.getByRole('textbox', {name: 'Short note'}), 'Confirm the new visit window.');
    await user.click(request.getByRole('button', {name: 'Save modification'}));
  }
  expect(await screen.findByText('No records for this program.')).toBeVisible();
  const east = createStore(localStorage, 'east-bay');
  expect(east.bootstrap().ok).toBe(true);
  expect(east.getSnapshot().sites[MARSH].decisions).toEqual([
    expect.objectContaining({verb: verb.toLowerCase(), rationale, actorId: PERSON.priya}),
  ]);
  expect(west.recover().data.sites[PORTSIDE]).toEqual(westBefore);
  if (verb === 'Approve') {
    await user.type(screen.getByRole('combobox', {name: 'Search site id or name'}), MARSH);
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('tab', {name: /^Audit/}));
    const audit = within(screen.getByRole('region', {name: 'Audit'}));
    const summary = audit.getByText(/^Approval · 12 May 2026 09:40 · Priya Raman$/);
    await user.click(summary);
    const event = within(summary.closest('li'));
    for (const value of ['ECO-2102-1', `snap_${MARSH}_seed`, MODEL, 'Approved — resequence', `Rationale: ${rationale}`, 'Priya Raman']) {
      expect(event.getByText(value, {exact: true})).toBeVisible();
    }
    expect(event.getByText('12 May 2026 09:40', {exact: true})).toHaveAttribute('datetime', BOARD_AT);
    expect(event.queryByText(new RegExp(`corr_${MARSH}_seed|^Correlation$`))).not.toBeInTheDocument();
  }
});

it('retains the site rationale through a real failed assessment on the same page', async () => {
  const store = createStore(localStorage);
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, PERSON.priya).ok).toBe(true);
  const notify = vi.fn();
  function Site() {
    const board = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return (
      <ApprovalDraftScope>
        <SiteWorkspace board={board} site={board.sites[PORTSIDE]} actor={readAccess(board)} store={store} notify={notify} />
      </ApprovalDraftScope>
    );
  }
  render(
    <MemoryRouter initialEntries={[`/sites/${PORTSIDE}?tab=approval`]} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
      <Site />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  const rationale = 'Civic Civil can take the pad in the confirmed window.';
  await user.type(screen.getByRole('textbox', {name: REASON_LABEL}), rationale);
  await act(async () => {
    const {faults} = store.getSnapshot();
    expect(store.commit({commandId: 'during-approval-outage'}, {writes: {
      faults: {...faults, rev: faults.rev + 1, assessmentDown: true, retryFailuresRemaining: 1},
    }}).ok).toBe(true);
    const result = await runAssessment(store, {
      commandId: 'failed-assessment-during-approval', siteId: PORTSIDE, expectedSiteRev: store.getSnapshot().sites[PORTSIDE].rev,
    });
    expect(result).toMatchObject({ok: true, data: {state: 'retained_outage'}});
  });
  expect(screen.getByRole('textbox', {name: REASON_LABEL})).toHaveValue(rationale);
  expect(store.getSnapshot().sites[PORTSIDE].decisions).toEqual([]);
  await user.click(screen.getByRole('button', {name: 'Approve', exact: true}));
  expect(store.getSnapshot().sites[PORTSIDE].decisions).toEqual([
    expect.objectContaining({verb: 'approve', rationale, workflowId: 'ECO-1866-1'}),
  ]);
});

/** Connect the panels to real committed snapshots, just as the workspace does. */
function mount(actorId, siteId, Panel, {withAudit = false} = {}) {
  const store = createStore(localStorage);
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, actorId).ok).toBe(true);
  const notify = vi.fn();
  function Panels() {
    const board = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const site = board.sites[siteId];
    const readiness = deriveReadiness(site, BOARD_AT, board.faults, board.audit.snapshots[site.assessment?.snapshotId]);
    return <>
      <Panel board={board} site={site} actor={readAccess(board)} readiness={readiness} store={store} notify={notify} />
      {withAudit && <AuditPanel board={board} site={site} />}
    </>;
  }
  render(<MemoryRouter future={{v7_startTransition: true, v7_relativeSplatPath: true}}><Panels /></MemoryRouter>);
  return {user: userEvent.setup(), store};
}

it('shows Portside’s before/after scope, rejects a short rationale and renders the saved approval', async () => {
  const {user, store} = mount(PERSON.priya, PORTSIDE, ApprovalPanel);
  const before = store.getSnapshot();
  const approval = within(screen.getByRole('region', {name: 'Approval'}));
  expect(approval.getByRole('heading', {name: 'Before'})).toBeVisible();
  expect(approval.getByText('Northwind Power')).toBeVisible();
  expect(approval.getByRole('heading', {name: 'After (proposed)'})).toBeVisible();
  expect(approval.getByText('Civic Civil')).toBeVisible();
  expect(approval.getByText('AGR-CC-1844')).toBeVisible();
  expect(approval.getByText('19 May 2026')).toBeVisible();
  expect(approval.getByText('A plan change does not authorize dispatch or move the working crew.')).toBeVisible();

  const rationale = approval.getByRole('textbox', {name: REASON_LABEL});
  await user.type(rationale, '  12345678901  ');
  await user.click(approval.getByRole('button', {name: 'Approve', exact: true}));
  expect(approval.getByRole('alert')).toHaveTextContent(/^Enter a rationale of at least 12 characters\.$/);
  expect(rationale).toBeInvalid();
  expect(approval.queryByRole('article')).not.toBeInTheDocument();
  expect(store.getSnapshot()).toBe(before);

  await user.clear(rationale);
  await user.type(rationale, '  123456789012  ');
  await user.click(approval.getByRole('button', {name: 'Approve', exact: true}));
  const decision = within(approval.getByRole('article'));
  expect(decision.getByRole('heading', {name: 'Approved — resequence'})).toBeVisible();
  expect(decision.getByText('123456789012')).toBeVisible();
  expect(decision.getByText(/ECO-1866-1 queued locally/)).toBeVisible();
  expect(approval.queryByRole('alert')).not.toBeInTheDocument();
});

it('renders saved modification rationale and note as literal text, including rationale in Audit', async () => {
  const {user} = mount(PERSON.priya, PORTSIDE, ApprovalPanel, {withAudit: true});
  const approval = within(screen.getByRole('region', {name: 'Approval'}));
  const rationale = '<strong>Keep the existing supplier</strong> & review the scope.';
  const note = '<em>Recheck power</em> & confirm the window.';
  await user.type(approval.getByRole('textbox', {name: REASON_LABEL}), rationale);
  await user.click(approval.getByRole('button', {name: 'Modify', exact: true}));
  const followUp = within(approval.getByRole('group', {name: 'Modify follow-up'}));
  await user.selectOptions(followUp.getByRole('combobox', {name: 'Owner'}), PERSON.ruth);
  fireEvent.change(followUp.getByLabelText('Due date'), {target: {value: '2026-05-14'}});
  await user.type(followUp.getByRole('textbox', {name: 'Short note'}), note);
  await user.click(followUp.getByRole('button', {name: 'Save modification'}));

  const article = approval.getByRole('article');
  const decision = within(article);
  expect(decision.getByRole('heading', {name: 'Modified', exact: true})).toBeVisible();
  expect(decision.getByText(rationale)).toBeVisible();
  expect(decision.getByText(`Ruth Ibarra · 14 May 2026 · ${note}`)).toBeVisible();
  expect(article.querySelector('strong, em')).toBeNull();

  const audit = within(screen.getByRole('region', {name: 'Audit'}));
  const summary = audit.getByText(/^Modified · .* · Priya Raman$/);
  await user.click(summary);
  const event = summary.closest('li');
  expect(within(event).getByText(`Rationale: ${rationale}`)).toBeVisible();
  expect(event.querySelector('strong')).toBeNull();
});

it('explains a viewer’s blocked approval and shows only redacted facts in audit', async () => {
  const {user} = mount(PERSON.jordan, PORTSIDE, ApprovalPanel, {withAudit: true});
  const approval = within(screen.getByRole('region', {name: 'Approval'}));
  expect(approval.getByRole('button', {name: 'Approve', exact: true})).toBeDisabled();
  expect(approval.getByRole('button', {name: 'Approve', exact: true})).toHaveAccessibleDescription(/Regional Viewer/);
  expect(approval.queryByRole('textbox', {name: REASON_LABEL})).not.toBeInTheDocument();
  await user.click(approval.getByRole('button', {name: 'Record denied approval attempt'}));
  const audit = within(screen.getByRole('region', {name: 'Audit'}));
  const summary = audit.getByText(/^Approval denied · .* · Jordan Ellis$/);
  await user.click(summary);
  const denial = within(summary.closest('li'));
  expect(denial.getByText(/Attempted action: approve · Reason: FORBIDDEN/)).toBeVisible();
  expect(denial.queryByText(/Rationale:|Input snapshot ID|Assessed prerequisite snapshot/)).not.toBeInTheDocument();
});

it('exposes Harbor’s held state, disabled dispatch reason and separate resequence review', () => {
  mount(PERSON.andre, HARBOR, FieldStrip);
  const field = within(screen.getByRole('region', {name: 'Field execution'}));
  expect(field.getByRole('button', {name: 'Hold crew', pressed: true})).toBeDisabled();
  const dispatch = field.getByRole('button', {name: 'Dispatch crew'});
  expect(dispatch).toBeDisabled();
  expect(dispatch).toHaveAccessibleDescription('Power is Not Ready and the site is on hold.');
  expect(field.getByRole('button', {name: 'Resequence', exact: true})).toBeDisabled();
  expect(field.getByRole('link', {name: 'Review resequence in Approval'})).toHaveAttribute('href', `/sites/${HARBOR}?tab=approval`);
});

it('cancels Civic Center dispatch without a write, then confirms and expands its assessed audit snapshot', async () => {
  const {user, store} = mount(PERSON.andre, CIVIC, FieldStrip, {withAudit: true});
  const before = store.getSnapshot();
  const field = within(screen.getByRole('region', {name: 'Field execution'}));
  const dispatch = field.getByRole('button', {name: 'Dispatch crew'});
  const confirmation = () => within(screen.getByRole('dialog', {name: 'Confirm dispatch crew'}));
  await user.click(dispatch);
  expect(confirmation().getByText(/Dispatch Luis Ortega’s crew of 4 to Civic Center on 16 May 2026 at 07:00/)).toBeVisible();
  await user.click(confirmation().getByRole('button', {name: 'Cancel'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(dispatch).toHaveFocus();
  expect(store.getSnapshot()).toBe(before);

  await user.click(dispatch);
  await user.click(confirmation().getByRole('button', {name: 'Confirm', exact: true}));
  expect(field.getByText('Crew status: Dispatched')).toBeVisible();
  expect(dispatch).toBeDisabled();
  const audit = within(screen.getByRole('region', {name: 'Audit'}));
  const summary = audit.getByText(/^Dispatched · .* · Andre Cole$/);
  await user.click(summary);
  const event = within(summary.closest('li'));
  expect(event.getByText('snap_1847_0511')).toBeVisible();
  expect(event.getByText('Working evidence revision at execution').nextElementSibling).toHaveTextContent(/^0$/);
  const snapshot = event.getByText('Assessed prerequisite snapshot');
  expect(snapshot.parentElement).not.toHaveAttribute('open');
  await user.click(snapshot);
  expect(snapshot.parentElement).toHaveAttribute('open');
  expect(event.getByText(/^Power · Ready · Current ·/)).toBeVisible();
});
