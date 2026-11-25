// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup, createEvent, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterAll, afterEach, beforeAll, beforeEach, expect, it, vi} from 'vitest';
import App from '../src/App.jsx';
import {BOARD_KEYS, makeBaseline} from '../src/data/baseline.js';
import {PERSON} from '../src/data/people.js';
import {continueAs} from '../src/utils/access.js';
import {createBrowserStore, STORAGE_PREFIX} from '../src/utils/storage.js';

const restoreTitle = 'Restore morning snapshot';
const rawKey = name => `${STORAGE_PREFIX}${name}`;
const rawStorage = () => Object.fromEntries(Object.keys(localStorage).map(name => [name, localStorage.getItem(name)]));
const stored = name => JSON.parse(localStorage.getItem(rawKey(name))).value;

// jsdom versions without these native methods need only the open-state transition.
const dialogMethods = {
  showModal() { this.setAttribute('open', ''); },
  close() { this.removeAttribute('open'); },
};
const installedMethods = [];
beforeAll(() => {
  for (const [name, value] of Object.entries(dialogMethods)) {
    if (typeof HTMLDialogElement.prototype[name] !== 'function') {
      Object.defineProperty(HTMLDialogElement.prototype, name, {configurable: true, value});
      installedMethods.push(name);
    }
  }
});
afterAll(() => {
  for (const name of installedMethods) delete HTMLDialogElement.prototype[name];
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/service-health');
  const store = createBrowserStore();
  expect(store.bootstrap().ok).toBe(true);
  expect(continueAs(store, PERSON.samira).ok).toBe(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Target a real browser-storage write while leaving every other operation intact. */
function denyWrite(name) {
  const setItem = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === rawKey(name)) throw new DOMException('Storage write denied', 'QuotaExceededError');
    return setItem.call(this, key, value);
  });
}

const scenarioControl = () => screen.getByRole('combobox', {name: 'Workshop scenario'});
const outageSwitch = name => screen.getByRole('switch', {name: `${name} manual outage`});
const restoreOpener = () => screen.getByRole('button', {name: `${restoreTitle}…`, exact: true});
const restoreDialog = () => screen.getByRole('dialog', {name: restoreTitle});

it('shows committed source changes, distinguishes manual and scenario outages, and opens Portside on selection', async () => {
  const user = userEvent.setup();
  render(<App />);
  const sources = within(screen.getByRole('list', {name: 'Local sources'}));
  expect(sources.getAllByRole('listitem')).toHaveLength(7);
  expect(sources.getAllByRole('switch')).toHaveLength(2);
  const city = sources.getAllByRole('listitem').find(row => within(row).queryByRole('heading', {name: 'City portal'}));
  expect(within(city).getByText('Delayed', {exact: true})).toBeVisible();

  await user.click(outageSwitch('DDL'));
  expect(outageSwitch('DDL')).toBeChecked();
  expect(screen.getByRole('button', {name: 'DDL · Down · synced 09:22'})).toBeVisible();
  expect(screen.getByText('DDL is Down')).toBeVisible();
  await user.selectOptions(scenarioControl(), 'D');
  expect(scenarioControl()).toHaveValue('D');
  expect(outageSwitch('Assessment service')).not.toBeChecked();
  const score = within(screen.getByRole('region', {name: 'Snapshot'}));
  expect(score.getByText('Assessment service unavailable')).toBeVisible();
  expect(score.getByText(/Showing the score from .*09:34/)).toBeVisible();
  expect(score.getByRole('link', {name: 'Open last assessment'})).toHaveAttribute('href', '/sites/NRO-W-1842?tab=prediction');

  await user.selectOptions(scenarioControl(), 'C');
  expect(await screen.findByRole('tab', {name: 'Approval'})).toHaveAttribute('aria-selected', 'true');
  expect(window.location.pathname + window.location.search).toBe('/sites/NRO-W-1866?tab=approval');
  expect(stored('scenario')).toBe('C');
  expect(screen.getByRole('button', {name: 'DDL · Down · synced 09:22'})).toBeVisible();
});

it.each(['manual outage', 'scenario selection'])('reports a failed %s without changing controls, storage, or route', async interaction => {
  const user = userEvent.setup();
  render(<App />);
  const before = rawStorage();
  denyWrite('pendingCommit');

  if (interaction === 'manual outage') await user.click(outageSwitch('DDL'));
  else await user.selectOptions(scenarioControl(), 'C');

  expect(screen.getByText('No changes confirmed.')).toBeVisible();
  expect(screen.getByRole('heading', {name: 'Service health'})).toBeVisible();
  expect(scenarioControl()).toHaveValue('A');
  expect(outageSwitch('DDL')).not.toBeChecked();
  expect(screen.getByRole('button', {name: 'DDL · Up · synced 09:22'})).toBeVisible();
  expect(screen.queryByText(/selected$|DDL is Down/)).not.toBeInTheDocument();
  expect(window.location.pathname + window.location.search).toBe('/service-health');
  expect(rawStorage()).toEqual(before);
});

it.each(['Cancel button', 'native cancel', 'backdrop'])('dismisses restore via %s without changing raw storage', async dismissal => {
  const user = userEvent.setup();
  render(<App />);
  await user.selectOptions(scenarioControl(), 'D');
  const before = rawStorage();
  const opener = restoreOpener();
  await user.click(opener);
  const dialog = restoreDialog();
  expect(dialog).toHaveAccessibleDescription(/Restores West Metro to the 09:40 record/);
  const cancel = within(dialog).getByRole('button', {name: 'Cancel'});
  expect(cancel).toHaveFocus();

  if (dismissal === 'Cancel button') await user.click(cancel);
  else if (dismissal === 'backdrop') await user.click(dialog);
  else {
    // jsdom does not turn Escape into the browser-generated dialog cancel event.
    fireEvent(dialog, createEvent('cancel', dialog, {cancelable: true}));
  }

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(opener).toHaveFocus());
  expect(scenarioControl()).toHaveValue('D');
  expect(screen.queryByText('Morning snapshot restored')).not.toBeInTheDocument();
  expect(rawStorage()).toEqual(before);
});

it('keeps a failed confirmation open, then restores the morning board after a successful retry', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.selectOptions(scenarioControl(), 'D');
  await user.click(outageSwitch('DDL'));
  localStorage.setItem('unrelated.preference', 'keep me');
  const before = rawStorage();
  await user.click(restoreOpener());
  const dialog = restoreDialog();
  const confirm = within(dialog).getByRole('button', {name: restoreTitle});
  const deny = denyWrite('pendingCommit');

  await user.click(confirm);
  expect(within(dialog).getByRole('alert')).toHaveTextContent('No changes confirmed.');
  expect(dialog).toBeVisible();
  expect(scenarioControl()).toHaveValue('D');
  expect(screen.queryByText('Morning snapshot restored')).not.toBeInTheDocument();
  expect(rawStorage()).toEqual(before);

  deny.mockRestore();
  await user.click(confirm);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('Morning snapshot restored')).toBeVisible();
  expect(scenarioControl()).toHaveValue('A');
  expect(outageSwitch('DDL')).not.toBeChecked();
  expect(screen.getByRole('button', {name: /Samira Qureshi/})).toBeVisible();
  await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  const baseline = makeBaseline();
  baseline.audit.generation = 1;
  const expected = {...before};
  for (const name of BOARD_KEYS) expected[rawKey(name)] = JSON.stringify({schemaVersion: 1, value: baseline[name]});
  expect(rawStorage()).toEqual(expected);
});

it('hides Health on an interrupted restore and rolls the journal forward on reload', async () => {
  const user = userEvent.setup();
  const app = render(<App />);
  await user.selectOptions(scenarioControl(), 'D');
  await user.click(restoreOpener());
  const deny = denyWrite('sites');
  const dialog = restoreDialog();
  await user.click(within(dialog).getByRole('button', {name: restoreTitle}));

  expect(screen.getByRole('heading', {name: 'Board unavailable'})).toBeInTheDocument();
  expect(screen.queryByRole('heading', {name: 'Service health'})).not.toBeInTheDocument();
  expect(within(dialog).getByRole('alert')).toHaveTextContent(/Board unavailable/);
  expect(screen.queryByText('Morning snapshot restored')).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(rawKey('pendingCommit')))).toMatchObject({mode: 'restore', targetGeneration: 1});

  app.unmount();
  deny.mockRestore();
  render(<App />);
  expect(screen.getByRole('heading', {name: 'Service health'})).toBeVisible();
  expect(scenarioControl()).toHaveValue('A');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(localStorage.getItem(rawKey('pendingCommit'))).toBeNull();
  expect(stored('audit').generation).toBe(1);
  expect(stored('session').userId).toBe(PERSON.samira);
});

it('leaves a corrupt journal untouched on Try again and replaces it only after explicit confirmation', async () => {
  const user = userEvent.setup();
  localStorage.setItem(rawKey('pendingCommit'), '{broken');
  const before = rawStorage();
  render(<App />);

  expect(screen.getByRole('heading', {name: 'Board unavailable'})).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'Try again'}));
  expect(screen.getByRole('heading', {name: 'Board unavailable'})).toBeVisible();
  expect(rawStorage()).toEqual(before);

  await user.click(restoreOpener());
  expect(rawStorage()).toEqual(before);
  await user.click(within(restoreDialog()).getByRole('button', {name: restoreTitle}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('Morning snapshot restored')).toBeVisible();
  expect(screen.getByRole('heading', {name: 'Service health'})).toBeVisible();
  expect(scenarioControl()).toHaveValue('A');
  expect(localStorage.getItem(rawKey('pendingCommit'))).toBeNull();
  expect(localStorage.getItem(rawKey('session'))).toBe(before[rawKey('session')]);
});
