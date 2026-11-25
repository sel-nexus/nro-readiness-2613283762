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

function renderEvidence({person = PERSON.elena, siteId = HARBOR, prediction = false} = {}) {
  const store = createBrowserStore();
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, person).ok).toBe(true);
  const notify = vi.fn();

  function Panels() {
    const board = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const site = board.sites[siteId];
    const props = {board, site, store, actor: readAccess(board), readiness: deriveReadiness(site, undefined, board.faults)};
    return (
      <>
        <EvidenceMatrix {...props} notify={notify} />
        {prediction && <PredictionPanel {...props} />}
      </>
    );
  }

  render(
    <MemoryRouter future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
      <Panels />
    </MemoryRouter>,
  );
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
  expect(prediction.getByRole('link', {name: 'Power Not Ready'})).toHaveAttribute('href', '/sites/NRO-W-1842?tab=evidence#evidence-Power');
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
