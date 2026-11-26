// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useSyncExternalStore} from 'react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {EvidenceMatrix} from '../src/components/EvidenceMatrix.jsx';
import {PredictionPanel} from '../src/components/PredictionPanel.jsx';
import {PERSON} from '../src/data/people.js';
import SiteWorkspace from '../src/pages/SiteWorkspace.jsx';
import {siteProgram} from '../src/data/programs.js';
import {continueAs, readAccess} from '../src/utils/access.js';
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
    if (tab) return <SiteWorkspace {...props} notify={notify} />;
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
  expect(screen.getByRole('link', {name: 'Back to Board'})).toHaveAttribute('href', '/board');
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
  expect(screen.getByRole('link', {name: 'Back to Board'})).toHaveAttribute('href', '/board?program=east-bay');
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
