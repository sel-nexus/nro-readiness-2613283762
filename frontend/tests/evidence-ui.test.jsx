// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useSyncExternalStore} from 'react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import App from '../src/App.jsx';
import {EvidenceMatrix} from '../src/components/EvidenceMatrix.jsx';
import {PredictionPanel} from '../src/components/PredictionPanel.jsx';
import {DIRECTORY, PERSON} from '../src/data/people.js';
import {ProgramBoard} from '../src/pages/Portfolio.jsx';
import SiteWorkspace from '../src/pages/SiteWorkspace.jsx';
import {makeProgramBoard, siteProgram} from '../src/data/programs.js';
import {continueAs, readAccess, switchUser} from '../src/utils/access.js';
import {deriveReadiness} from '../src/utils/readiness.js';
import {createBrowserStore} from '../src/utils/storage.js';

const HARBOR = 'NRO-W-1842';

const dialogPrototype = HTMLDialogElement.prototype;
const originalDialogMethods = Object.getOwnPropertyDescriptors(dialogPrototype);
const dialogMethods = {
  showModal() { this.open = true; },
  close() { this.open = false; },
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  // Supply only the native dialog methods not implemented by jsdom.
  for (const [name, value] of Object.entries(dialogMethods)) {
    if (!originalDialogMethods[name]?.value) Object.defineProperty(dialogPrototype, name, {configurable: true, value});
  }
});

afterEach(() => {
  cleanup();
  for (const name of Object.keys(dialogMethods)) {
    if (originalDialogMethods[name]) Object.defineProperty(dialogPrototype, name, originalDialogMethods[name]);
    else delete dialogPrototype[name];
  }
});

function renderEvidence({person = PERSON.elena, siteId = HARBOR, prediction = false, tab, down = false} = {}) {
  const accessStore = createBrowserStore();
  expect(accessStore.bootstrap().ok).toBe(true);
  expect(continueAs(accessStore, person).ok).toBe(true);
  const store = siteProgram(siteId) === 'west-metro' ? accessStore : createBrowserStore(siteProgram(siteId));
  if (store !== accessStore) expect(store.bootstrap().ok).toBe(true);
  if (down) {
    const {faults} = store.getSnapshot();
    expect(store.commit({commandId: 'fixture-outage'}, {writes: {
      faults: {...faults, rev: faults.rev + 1, assessmentDown: true, retryFailuresRemaining: 1},
    }}).ok).toBe(true);
  }
  const notify = vi.fn();

  function Panels() {
    const board = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const site = board.sites[siteId];
    const props = {board, site, store, actor: readAccess(board), readiness: deriveReadiness(site, undefined, board.faults)};
    if (tab) return <main><SiteWorkspace {...props} notify={notify} /></main>;
    return (
      <>
        <EvidenceMatrix {...props} notify={notify} />
        {prediction && <PredictionPanel {...props} />}
      </>
    );
  }

  render(
    <MemoryRouter initialEntries={[`/sites/${siteId}${tab ? `?tab=${tab}` : ''}`]} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
      <Panels />
    </MemoryRouter>,
  );
  return store;
}

it.each([
  ['Ready', null, 'Power evidence shows Ready.'],
  ['In progress', null, 'Power evidence shows In progress.'],
  ['Not Ready', '2026-04-30T09:00', 'Verify Power evidence.'],
  ['Unavailable', '', 'Verify Power evidence.'],
  ['Unavailable', null, 'Verify Power evidence.'],
])('updates the Harbor Point decision for Power %s at %s without lifting the hold', async (status, sourceAt, detail) => {
  const user = userEvent.setup();
  const store = createBrowserStore();
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, PERSON.elena).ok).toBe(true);
  window.history.replaceState({}, '', '/board');
  render(<App />);
  const main = within(await screen.findByRole('main'));
  const morning = 'Harbor Point is on hold. Power is not ready.';
  expect(main.getByText(morning, {exact: true})).toBeVisible();
  await user.click(main.getByRole('link', {name: 'Review Harbor Point'}));
  await user.click(main.getByRole('button', {name: 'Update Power'}));
  const drawer = within(main.getByRole('dialog', {name: 'Update Power evidence'}));
  await user.selectOptions(drawer.getByLabelText('Status'), status);
  if (sourceAt !== null) fireEvent.change(drawer.getByLabelText('Evidence date and time'), {target: {value: sourceAt}});
  await user.click(drawer.getByRole('button', {name: 'Save evidence'}));
  expect(main.getByRole('heading', {level: 1})).toHaveTextContent(/Harbor Point is .+\. Keep the crew on hold\./);
  const nav = within(screen.getByRole('navigation', {name: 'Program'}));
  const boardNav = nav.getByRole('link', {name: 'Board', exact: true});
  expect(boardNav).toHaveAttribute('aria-current', 'location');
  await user.click(main.getByRole('link', {name: 'Board', exact: true}));
  expect(await main.findByText(`Harbor Point is on hold. ${detail}`, {exact: true})).toBeVisible();
  expect(main.queryByText(morning, {exact: true})).not.toBeInTheDocument();
  const harbor = within(main.getByRole('row', {name: /Harbor Point/}));
  expect(harbor.getByRole('cell', {name: 'Hold', exact: true})).toBeVisible();
  expect(harbor.getByRole('cell', {name: 'Unavailable', exact: true})).toBeVisible();
});

it.each([
  ['dispatched', 'Harbor Point has been dispatched.', null],
  ['on_air', 'Harbor Point is on air.', '2026-05-12T09:30:00'],
])('renders the recorded Harbor Point lifecycle %s instead of open-site advice', (lifecycle, decision, closedAt) => {
  // The UI cannot clear Harbor's seed hold; exercise supported historical records as component inputs.
  const board = makeProgramBoard();
  const harbor = board.sites[HARBOR];
  const site = {
    ...harbor, lifecycle, holdActive: false, plan: {...harbor.plan, closedAt},
    disposition: lifecycle === 'dispatched' ? 'Dispatched' : 'On air',
  };
  const historical = {...board, sites: {...board.sites, [HARBOR]: site}};
  render(
    <MemoryRouter initialEntries={['/board']} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
      <ProgramBoard board={historical} programId="west-metro" query="" />
    </MemoryRouter>,
  );
  expect(screen.getByText(decision, {exact: true})).toBeVisible();
  expect(screen.queryByText('Harbor Point is on hold. Power is not ready.', {exact: true})).not.toBeInTheDocument();
});

it.each([
  ['east-bay', 'Delta Landing', 'Power', 'Ready', 'Delta Landing is on hold. The utility handoff is incomplete.',
    'Delta Landing is on hold. Power evidence shows Ready.'],
  ['north-valley', 'Orchard Exchange', 'Permit', 'Ready', 'Orchard Exchange needs a permit before the pilot visit can proceed.',
    'Review Orchard Exchange before committing a crew. Permit evidence shows Ready.'],
  ['north-valley', 'Orchard Exchange', 'Permit', 'Not Ready', 'Orchard Exchange needs a permit before the pilot visit can proceed.',
    'Review Orchard Exchange before committing a crew. Permit is not ready.'],
  ['south-shore', 'Dune Crossing', 'Permit', 'Ready', 'Dune Crossing remains on hold after a failed visit. Site access is not ready.',
    'Dune Crossing is on hold. Permit evidence shows Ready.'],
])('updates the %s Board when %s %s becomes %s', async (program, site, row, status, morning, updated) => {
  const user = userEvent.setup();
  const west = createBrowserStore();
  expect(west.bootstrap().ok).toBe(true);
  expect(continueAs(west, PERSON.elena).ok).toBe(true);
  const harbor = west.getSnapshot().sites[HARBOR];
  window.history.replaceState({}, '', `/board?program=${program}`);
  render(<App />);
  const main = within(await screen.findByRole('main'));
  expect(main.getByText(morning, {exact: true})).toBeVisible();
  await user.click(main.getByRole('link', {name: `Review ${site}`}));
  await user.click(main.getByRole('button', {name: `Update ${row}`}));
  const drawer = within(main.getByRole('dialog', {name: `Update ${row} evidence`}));
  await user.selectOptions(drawer.getByLabelText('Status'), status);
  await user.click(drawer.getByRole('button', {name: 'Save evidence'}));
  await user.click(main.getByRole('link', {name: 'Board', exact: true}));
  expect(await main.findByText(updated, {exact: true})).toBeVisible();
  expect(main.queryByText(morning, {exact: true})).not.toBeInTheDocument();
  expect(west.recover().data.sites[HARBOR]).toEqual(harbor);
});

it('keeps Harbor on hold after a Ready Power edit removes the ranked blocker', async () => {
  const user = userEvent.setup();
  const store = renderEvidence({tab: 'evidence'});
  await user.click(screen.getByRole('button', {name: 'Update Power'}));
  const drawer = within(screen.getByRole('dialog', {name: 'Update Power evidence'}));
  await user.selectOptions(drawer.getByLabelText('Status'), 'Ready');
  await user.click(drawer.getByRole('button', {name: 'Save evidence'}));
  expect(within(screen.getByRole('row', {name: /^Power\b/})).getByRole('cell', {name: 'Ready', exact: true})).toBeVisible();
  await user.click(screen.getByRole('tab', {name: 'Blockers and action'}));

  const action = within(screen.getByRole('region', {name: 'Blockers and action'}));
  expect(action.queryByRole('list', {name: 'Ranked prerequisites'})).not.toBeInTheDocument();
  expect(action.queryByText(/can proceed/i)).not.toBeInTheDocument();
  expect(action.getByText('No ranked blocker. Keep the crew on hold.')).toBeVisible();

  act(() => { expect(switchUser(store, PERSON.andre).ok).toBe(true); });
  const dispatch = within(screen.getByRole('region', {name: 'Field execution'})).getByRole('button', {name: 'Dispatch crew'});
  expect(dispatch).toBeDisabled();
  expect(dispatch).toHaveAccessibleDescription('The site is on hold.');
});

it('keeps watch-only evidence from implying clearance after the score becomes historical', async () => {
  const user = userEvent.setup();
  renderEvidence({siteId: 'NRO-W-1878', tab: 'action'});
  expect(screen.getByText('No ranked blocker. Check field requirements before dispatch.')).toBeVisible();

  await user.click(screen.getByRole('tab', {name: 'Evidence'}));
  await user.click(screen.getByRole('button', {name: 'Update Civil'}));
  const drawer = within(screen.getByRole('dialog', {name: 'Update Civil evidence'}));
  await user.selectOptions(drawer.getByLabelText('Status'), 'In progress');
  await user.click(drawer.getByRole('button', {name: 'Save evidence'}));
  await user.click(screen.getByRole('tab', {name: 'Blockers and action'}));

  expect(screen.getByText('Assessment · Last probability (historical) · Confidence')).toBeVisible();
  const action = within(screen.getByRole('region', {name: 'Blockers and action'}));
  expect(action.getByRole('list', {name: 'Ranked prerequisites'})).toHaveTextContent('Watch item · Civil');
  expect(action.queryByText(/can proceed/i)).not.toBeInTheDocument();
  expect(action.getByText('No verified ranked blocker. A current readiness score is unavailable.')).toBeVisible();
});

it('shows Portside’s exact pending follow-up without clearing dispatch', () => {
  renderEvidence({person: PERSON.andre, siteId: 'NRO-W-1866', tab: 'action'});
  const action = within(screen.getByRole('region', {name: 'Blockers and action'}));
  expect(action.getByText('No verified ranked blocker. Review the follow-up below.', {exact: true})).toBeVisible();
  const ranked = within(action.getByRole('list', {name: 'Ranked prerequisites'}));
  expect(ranked.getByText('Pending action · Power · In progress (Current)', {exact: true})).toBeVisible();
  expect(action.getByRole('heading', {name: 'Assessment recommendation', exact: true})).toBeVisible();
  expect(action.getByText('Pending approval · Ask Priya to move the pad from Northwind Power to Civic Civil and the date from 15 May to 19 May.', {exact: true})).toBeVisible();
  expect(action.getByText('Owner: Priya Raman · Due: 12 May 2026', {exact: true})).toBeVisible();
  expect(action.getByRole('link', {name: 'Review in Approval'})).toHaveAttribute('href', '/sites/NRO-W-1866?tab=approval');
  const dispatch = within(screen.getByRole('region', {name: 'Field execution'})).getByRole('button', {name: 'Dispatch crew'});
  expect(dispatch).toBeDisabled();
  expect(dispatch).toHaveAccessibleDescription('Dispatch requires all mandatory evidence to be Current and Ready.');
});

it('labels Civic Center’s retained recommendation historical and blocks dispatch during an outage', () => {
  const store = renderEvidence({person: PERSON.andre, siteId: 'NRO-W-1847', tab: 'action'});
  const action = within(screen.getByRole('region', {name: 'Blockers and action'}));
  const field = within(screen.getByRole('region', {name: 'Field execution'}));
  const followUp = 'Recommended · Andre dispatches Luis Ortega, crew of 4, 16 May 07:00.';
  expect(action.getByRole('heading', {name: 'Assessment recommendation', exact: true})).toBeVisible();
  expect(action.getByText(followUp, {exact: true})).toBeVisible();
  expect(field.getByRole('button', {name: 'Dispatch crew'})).toBeEnabled();

  const {faults} = store.getSnapshot();
  act(() => {
    expect(store.commit({commandId: 'civic-assessment-outage'}, {writes: {
      faults: {...faults, rev: faults.rev + 1, assessmentDown: true},
    }}).ok).toBe(true);
  });

  expect(action.getByText('No verified ranked blocker. A current readiness score is unavailable.')).toBeVisible();
  expect(action.getByText(followUp, {exact: true})).toBeVisible();
  const dispatch = field.getByRole('button', {name: 'Dispatch crew'});
  expect(dispatch).toBeDisabled();
  expect(dispatch).toHaveAccessibleDescription('Dispatch requires a current assessment.');
  expect(action.getByRole('heading', {name: 'Assessment recommendation · Historical', exact: true})).toBeVisible();
});

it('does not advise proceeding when an outage leaves an unranked site without a current score', () => {
  renderEvidence({siteId: 'NRO-W-1884', tab: 'action', down: true});
  const action = within(screen.getByRole('region', {name: 'Blockers and action'}));
  expect(action.queryByRole('list', {name: 'Ranked prerequisites'})).not.toBeInTheDocument();
  expect(action.queryByText(/can proceed/i)).not.toBeInTheDocument();
  expect(action.getByText('No verified ranked blocker. A current readiness score is unavailable.')).toBeVisible();
});

it('shows the evidence repair when the recorded readiness score is unavailable', () => {
  renderEvidence({siteId: 'NRO-W-1872', tab: 'action'});
  const action = within(screen.getByRole('region', {name: 'Blockers and action'}));
  expect(action.getByText('No verified ranked blocker. A current readiness score is unavailable.')).toBeVisible();
  expect(action.getByRole('list', {name: 'Ranked prerequisites'})).toHaveTextContent('Evidence repair · Transmission');
});

it.each([
  ['NRO-W-1810', 'Fruitvale is on air.', 'This site is closed.'],
  ['NRO-W-1822', /Jack London is .+\. The crew has been dispatched\./, 'Crew already dispatched.'],
])('presents the recorded lifecycle instead of open-site advice at %s', (siteId, heading, reason) => {
  renderEvidence({person: PERSON.andre, siteId, tab: 'action'});
  expect(screen.getByRole('heading', {level: 1})).toHaveTextContent(heading);
  const action = within(screen.getByRole('region', {name: 'Blockers and action'}));
  expect(action.getByText('This site is not awaiting a ranked intervention.')).toBeVisible();
  expect(action.queryByRole('heading', {name: 'Assessment recommendation'})).not.toBeInTheDocument();
  const dispatch = within(screen.getByRole('region', {name: 'Field execution'})).getByRole('button', {name: 'Dispatch crew'});
  expect(dispatch).toBeDisabled();
  expect(dispatch).toHaveAccessibleDescription(reason);
});

it('shows the evidence owner and masked contact without exposing the full number in the DOM', () => {
  renderEvidence({person: PERSON.jordan});
  const {name, phone} = DIRECTORY[PERSON.ruth];
  const digits = phone.replace(/\D/g, '');
  const matrix = screen.getByRole('region', {name: 'Evidence provenance'});
  const power = within(screen.getByRole('row', {name: /^Power\b/}));
  expect(power.getByText(name, {exact: true})).toBeVisible();
  expect(power.getByText(`Phone ending in ${digits.slice(-4)}`, {exact: true})).toBeVisible();
  expect(matrix.outerHTML).not.toContain(phone);
  expect(matrix.outerHTML).not.toContain(digits);
  expect(matrix.querySelector('a[href^="tel:"]')).toBeNull();
});

it('keeps the original Harbor Point score time in the Board row during an outage', async () => {
  const store = createBrowserStore();
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, PERSON.elena).ok).toBe(true);
  const {faults} = store.getSnapshot();
  expect(store.commit({commandId: 'board-outage'}, {writes: {
    faults: {...faults, rev: faults.rev + 1, assessmentDown: true},
  }}).ok).toBe(true);
  window.history.replaceState({}, '', '/board');
  render(<App />);
  const main = within(await screen.findByRole('main'));
  const harbor = within(main.getByRole('row', {name: /Harbor Point/}));
  const retained = harbor.getByRole('cell', {name: /^34%/});
  expect(retained.querySelector('time')).toHaveAttribute('datetime', '2026-05-12T09:34:00');
  expect(retained.querySelector('time').parentElement.textContent).toBe('Scored 12 May 2026, 09:34.');
  expect(main.getByText(/^Evidence from DPAM/)).toHaveTextContent('Evidence from DPAM, POS, DDL, and ECO. Scored 12 May 2026, 09:34.');
});

it.each([
  ['NRO-E-2101', 'Power', 'Utility handoff incomplete'],
  ['NRO-E-2104', 'Civil', 'Civil works is monitored for the crew plan.'],
  ['NRO-W-1878', 'Civil', 'Civil · in progress. Civil works is monitored for the crew plan.'],
])('shows only the applicable dependency at %s for %s', (siteId, row, dependency) => {
  renderEvidence({siteId});
  const evidenceRow = within(screen.getByRole('row', {name: new RegExp(`^${row}\\b`)}));
  expect(evidenceRow.getByRole('cell', {name: dependency, exact: true})).toBeVisible();
  expect(evidenceRow.queryByRole('cell', {name: /Northwind window|Blocks the .* crew/})).not.toBeInTheDocument();
});

it('keeps the drawer open on rejection, then saves a correction and restores focus', async () => {
  const user = userEvent.setup();
  renderEvidence();
  const trigger = screen.getByRole('button', {name: 'Update Power'});
  await user.click(trigger);
  const drawer = screen.getByRole('dialog', {name: 'Update Power evidence'});
  const form = within(drawer);
  const timestamp = form.getByLabelText('Evidence date and time');
  const source = form.getByRole('textbox', {name: 'Source'});
  expect(form.getByRole('combobox', {name: 'Status'})).toHaveValue('Not Ready');
  expect(source).toHaveValue('Northwind Power feed');
  await user.selectOptions(form.getByLabelText('Status'), 'Ready');
  // Set the value produced by the native date/time picker, which jsdom cannot open.
  fireEvent.change(timestamp, {target: {value: ''}});
  const save = form.getByRole('button', {name: 'Save evidence'});
  await user.click(save);
  expect(form.getByRole('alert')).toHaveTextContent('leave it blank only for Unavailable');
  expect(timestamp).toHaveAttribute('aria-invalid', 'true');
  expect(drawer).toBeVisible();
  expect(screen.queryByText('Evidence changed. Run assessment to rescore.')).not.toBeInTheDocument();

  fireEvent.change(timestamp, {target: {value: '2026-05-12T09:00'}});
  await user.clear(source);
  await user.type(source, 'Utility dispatch desk');
  expect(form.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(save);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const power = within(screen.getByRole('row', {name: /^Power\b/}));
  expect(power.getByRole('cell', {name: 'Ready', exact: true})).toBeVisible();
  expect(power.getByText('Utility dispatch desk', {exact: true})).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Evidence changed. Run assessment to rescore.');
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('discards unsaved drawer changes when cancelled and restores the invoking control', async () => {
  const user = userEvent.setup();
  renderEvidence();
  const trigger = screen.getByRole('button', {name: 'Update Power'});
  await user.click(trigger);
  const drawer = within(screen.getByRole('dialog'));
  await user.selectOptions(drawer.getByLabelText('Status'), 'Ready');
  await user.click(drawer.getByRole('button', {name: 'Cancel'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.click(trigger);
  expect(within(screen.getByRole('dialog')).getByLabelText('Status')).toHaveValue('Not Ready');
});

it('displays submitted source and attachment labels as literal DOM text, not elements', async () => {
  const user = userEvent.setup();
  renderEvidence();
  const power = within(screen.getByRole('row', {name: /^Power\b/}));
  await user.click(power.getByRole('button', {name: 'Update Power'}));
  const drawer = within(screen.getByRole('dialog'));
  const source = '<strong data-test="source-label">Utility</strong>';
  fireEvent.change(drawer.getByRole('textbox', {name: 'Source'}), {target: {value: source}});
  await user.click(drawer.getByRole('button', {name: 'Save evidence'}));
  expect(power.getByText(source, {exact: true})).toBeVisible();
  expect(document.querySelector('[data-test="source-label"]')).toBeNull();

  const fileName = '<em data-test="file-label">scan.pdf';
  const file = new File(['sample'], fileName, {type: 'application/pdf'});
  await user.upload(power.getByLabelText('Attach evidence to Power'), file);
  expect(power.getByText(fileName, {exact: true})).toBeVisible();
  expect(document.querySelector('[data-test="file-label"]')).toBeNull();
});

it('saves an Unavailable row with a blank time and renders Missing with no timestamp', async () => {
  const user = userEvent.setup();
  renderEvidence();
  const power = within(screen.getByRole('row', {name: /^Power\b/}));
  await user.click(power.getByRole('button', {name: 'Update Power'}));
  const drawer = within(screen.getByRole('dialog'));
  await user.selectOptions(drawer.getByLabelText('Status'), 'Unavailable');
  fireEvent.change(drawer.getByLabelText('Evidence date and time'), {target: {value: ''}});
  await user.click(drawer.getByRole('button', {name: 'Save evidence'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(power.getByRole('cell', {name: 'Unavailable', exact: true})).toBeVisible();
  expect(power.getByRole('cell', {name: 'Missing', exact: true})).toBeVisible();
  expect(power.getByRole('cell', {name: 'No timestamp', exact: true})).toBeVisible();
});

it.each(['NRO-W-1810', 'NRO-W-1822'])('keeps historical evidence read-only for an Operator at %s', async siteId => {
  const user = userEvent.setup();
  renderEvidence({siteId});
  const update = screen.getByRole('button', {name: 'Update Power'});
  expect(update).toHaveAttribute('aria-disabled', 'true');
  expect(update).toHaveAccessibleDescription('Historical evidence is read-only.');
  await user.click(update);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Attach evidence to Power')).not.toBeInTheDocument();
});

it('gives a Viewer a read-only explanation and does not offer replay or attachments', async () => {
  const user = userEvent.setup();
  renderEvidence({person: PERSON.jordan, siteId: 'NRO-W-1872', prediction: true});
  const update = screen.getByRole('button', {name: 'Update Transmission'});
  expect(update).toHaveAccessibleDescription('Only Operators can update evidence.');
  await user.click(update);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Attach evidence to Transmission')).not.toBeInTheDocument();
  const prediction = within(screen.getByRole('region', {name: 'Assessment prediction'}));
  expect(prediction.getByText('Unavailable', {exact: true})).toBeVisible();
  expect(prediction.getByText('Confidence: 62% · Medium')).toBeVisible();
  expect(prediction.queryByRole('button', {name: 'Run assessment'})).not.toBeInTheDocument();
});

it('shows replay progress, then retains the same score as historical after unsupported inputs', async () => {
  const user = userEvent.setup();
  renderEvidence({prediction: true});
  const prediction = within(screen.getByRole('region', {name: 'Assessment prediction'}));
  const run = prediction.getByRole('button', {name: 'Run assessment'});
  expect(prediction.getByRole('link', {name: 'View evidence: Power Not Ready'})).toHaveAttribute('href', '/sites/NRO-W-1842?tab=evidence#evidence-Power');
  fireEvent.click(run);
  expect(run).toBeDisabled();
  expect(prediction.getByRole('status')).toHaveTextContent('Scoring…');
  await waitFor(() => expect(prediction.getByRole('status')).toHaveTextContent('Assessment complete. Probability 34%.'), {timeout: 2000});
  expect(run).toBeEnabled();
  const replayed = prediction.getByText(/corr_1842_r1/).textContent;

  await user.click(screen.getByRole('button', {name: 'Update Power'}));
  const drawer = within(screen.getByRole('dialog'));
  await user.selectOptions(drawer.getByLabelText('Status'), 'Ready');
  await user.click(drawer.getByRole('button', {name: 'Save evidence'}));
  expect(prediction.getByRole('heading', {name: 'Last score · Historical'})).toBeVisible();
  fireEvent.click(run);
  await waitFor(() => expect(prediction.getByRole('status'))
    .toHaveTextContent('No supported assessment matches these inputs. The last score is historical.'), {timeout: 2000});
  expect(prediction.getByText(replayed)).toBeVisible();
  expect(prediction.getByText('34%', {exact: true})).toBeVisible();
});

it('opens the retained evidence and keeps the Harbor Point crew gated for the dispatcher', async () => {
  const user = userEvent.setup();
  renderEvidence({person: PERSON.andre, tab: 'prediction'});
  expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Harbor Point is Critical. Hold the 18 May crew. Power is not ready.');
  expect(within(screen.getByRole('main')).getByRole('link', {name: 'Board', exact: true})).toHaveAttribute('href', '/board');
  expect(screen.getByText('Chance ready on 18 May 2026.')).toBeVisible();
  expect(screen.getByText('Assessment horizon: 6 days')).toBeVisible();
  expect(screen.getByText('Evidence is complete enough to rank the blocker. It is not enough to dispatch through a failed prerequisite.')).toBeVisible();
  const factors = screen.getByRole('list', {name: 'Score factors'});
  for (const [factor, points] of [['Power Not Ready', '+46'], ['Planned date inside 6 days', '+22'], ['Permit current', '−12'], ['Material on site', '−8']]) {
    const link = within(factors).getByRole('link', {name: `View evidence: ${factor}`});
    expect(link.closest('li')).toHaveTextContent(`${points} points`);
  }
  await user.click(within(factors).getByRole('link', {name: 'View evidence: Planned date inside 6 days'}));
  expect(document.querySelector('#site-plan')).toHaveFocus();
  await user.click(within(factors).getByRole('link', {name: 'View evidence: Power Not Ready'}));
  expect(screen.getByRole('tabpanel', {name: 'Evidence'})).toBeVisible();
  expect(screen.getByRole('columnheader', {name: 'Observed evidence status'})).toBeVisible();
  const power = within(screen.getByRole('row', {name: /^Power\b/}));
  const source = power.getByText('Northwind Power feed', {exact: true});
  expect(source).toHaveFocus();
  expect(source.closest('details')).toHaveAttribute('open');
  expect(power.getByText('Depends on the Northwind window. Blocks the 18 May crew.')).toBeVisible();
  await user.click(screen.getByRole('tab', {name: 'Blockers and action'}));
  const dispatch = screen.getByRole('button', {name: 'Dispatch crew'});
  expect(dispatch).toBeDisabled();
  expect(dispatch).toHaveAccessibleDescription('Power is Not Ready and the site is on hold.');
  expect(screen.getByRole('button', {name: 'Hold crew'})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Resequence', exact: true})).toHaveAccessibleDescription('Approval is required for the date move.');
});

it.each([PERSON.elena, PERSON.priya, PERSON.samira])('offers assessment to authorized persona %s on a healthy scoped site', person => {
  renderEvidence({person, siteId: 'NRO-E-2104', tab: 'prediction'});
  expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Willow Span is Good. Check the crew plan before dispatch.');
  expect(within(screen.getByRole('main')).getByRole('link', {name: 'Board', exact: true})).toHaveAttribute('href', '/board?program=east-bay');
  expect(screen.getByText('89%', {exact: true})).toBeVisible();
  expect(screen.getByRole('button', {name: 'Run assessment'})).toBeEnabled();
});

it('replays a healthy East Bay fixture without replacing West Metro’s morning score', async () => {
  const user = userEvent.setup();
  const store = renderEvidence({siteId: 'NRO-E-2104', tab: 'prediction'});
  const west = createBrowserStore();
  expect(west.bootstrap().ok).toBe(true);
  const morning = west.getSnapshot().sites[HARBOR].assessment;
  await user.click(screen.getByRole('button', {name: 'Run assessment'}));
  await screen.findByText('Assessment complete. Probability 89%.', {}, {timeout: 2000});
  expect(store.getSnapshot().sites['NRO-E-2104'].assessment.scoredAt).toBe('2026-05-12T09:40:00');
  expect(west.recover().data.sites[HARBOR].assessment).toEqual(morning);
});

it('keeps the exact morning result through failed run, failed retry and Keep last score, then refreshes on recovery', async () => {
  const user = userEvent.setup();
  const store = renderEvidence({tab: 'prediction', down: true});
  const morning = store.getSnapshot().sites[HARBOR].assessment;
  const outage = 'Assessment service unavailable. No new score was returned. Showing the score from 12 May 2026, 09:34.';
  const run = screen.getByRole('button', {name: 'Run assessment'});
  const retry = () => screen.getByRole('button', {name: 'Retry'});
  await user.click(run);
  await waitFor(() => expect(run).toBeEnabled(), {timeout: 2000});
  expect(screen.getByText(outage)).toBeVisible();
  expect(store.getSnapshot().sites[HARBOR].assessment).toEqual(morning);
  await user.click(retry());
  await waitFor(() => expect(retry()).toBeEnabled(), {timeout: 2000});
  expect(store.getSnapshot().faults.retryFailuresRemaining).toBe(0);
  expect(store.getSnapshot().sites[HARBOR].assessment).toEqual(morning);
  await user.click(screen.getByRole('button', {name: 'Keep last score'}));
  expect(screen.queryByRole('button', {name: 'Retry'})).not.toBeInTheDocument();
  expect(screen.getByText(outage)).toBeVisible();
  expect(screen.getByText('34%', {exact: true})).toBeVisible();
  await user.click(run);
  await waitFor(() => expect(retry()).toBeEnabled(), {timeout: 2000});
  await user.click(retry());
  await screen.findByText('Assessment complete. Probability 34%.', {}, {timeout: 2000});
  expect(store.getSnapshot().sites[HARBOR].assessment.scoredAt).toBe('2026-05-12T09:40:00');
  expect(screen.queryByText(outage)).not.toBeInTheDocument();
});
