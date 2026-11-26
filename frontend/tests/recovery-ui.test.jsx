// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup, createEvent, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterAll, afterEach, beforeAll, beforeEach, expect, it, vi} from 'vitest';
import App from '../src/App.jsx';
import {BOARD_KEYS, makeBaseline} from '../src/data/baseline.js';
import {PERSON} from '../src/data/people.js';
import {DEFAULT_PROGRAM} from '../src/data/programs.js';
import {siteFence} from '../src/services/evidence.js';
import {executeField, previewField} from '../src/services/decisions.js';
import {continueAs, readAccess, switchUser} from '../src/utils/access.js';
import {DEFAULT_THRESHOLDS} from '../src/utils/readiness.js';
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
  expect(within(scenarioControl()).getAllByRole('option').map(option => option.textContent))
    .toEqual(['Normal', 'Exception', 'Consequential decision', 'Service interruption']);
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
  expect(score.getByText('700 ms (simulated)')).toBeVisible();
  expect(score.getByText('Assessment service unavailable')).toBeVisible();
  expect(score.getByText(/Showing the score from .*09:34/)).toBeVisible();
  expect(score.getByRole('link', {name: 'Open last assessment'})).toHaveAttribute('href', '/sites/NRO-W-1842?tab=prediction');
  await user.click(screen.getByRole('link', {name: 'Board', exact: true}));
  const harbor = within(screen.getByRole('table', {name: 'Site readiness register'})).getByRole('link', {name: 'Harbor Point', exact: true});
  expect(within(harbor.closest('tr')).getByText('34%')).toBeVisible();
  expect(within(harbor.closest('tr')).getByText('12 May 2026, 09:34')).toHaveAttribute('datetime', '2026-05-12T09:34:00');
  await user.click(screen.getByRole('link', {name: 'Service health'}));

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
  expect(dialog).toHaveAccessibleDescription(/Restores all programs .* You stay signed in/);
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

it.each(['sites', 'program.north-valley.program'])('rolls all programs forward after a restore write fails at %s', async deniedKey => {
  const programs = [DEFAULT_PROGRAM, 'east-bay', 'north-valley', 'south-shore'];
  const stores = programs.map(id => createBrowserStore(id));
  for (const store of stores) expect(store.bootstrap().ok).toBe(true);
  const morning = rawStorage();
  for (const [index, store] of stores.entries()) {
    const thresholds = {...DEFAULT_THRESHOLDS, goodProbability: 90 + index};
    expect(store.saveThresholds(thresholds, 'change-before-restore').ok).toBe(true);
    expect(store.getSnapshot().program.thresholds).toEqual(thresholds);
  }
  const user = userEvent.setup();
  const app = render(<App />);
  await user.selectOptions(scenarioControl(), 'D');
  await user.click(restoreOpener());
  const deny = denyWrite(deniedKey);
  const dialog = restoreDialog();
  await user.click(within(dialog).getByRole('button', {name: restoreTitle}));

  expect(screen.getByRole('heading', {name: 'Board unavailable'})).toBeInTheDocument();
  expect(screen.queryByRole('heading', {name: 'Service health'})).not.toBeInTheDocument();
  expect(within(dialog).getByRole('alert')).toHaveTextContent(/Board unavailable/);
  expect(screen.queryByText('Morning snapshot restored')).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(rawKey('pendingCommit')))).toMatchObject({mode: 'restore', targetGeneration: 1,
    targets: {'east-bay': 1, 'north-valley': 1, 'south-shore': 1}});
  if (deniedKey === 'program.north-valley.program') {
    expect(stored('program.east-bay.program').thresholds).toBeUndefined();
    expect(stored('program.north-valley.program').thresholds.goodProbability).toBe(92);
    expect(stored('program.south-shore.program').thresholds.goodProbability).toBe(93);
    expect(createBrowserStore('south-shore').bootstrap()).toMatchObject({ok: false, error: {code: 'RECOVERY_REQUIRED'}});
  }

  app.unmount();
  deny.mockRestore();
  render(<App />);
  expect(screen.getByRole('heading', {name: 'Service health'})).toBeVisible();
  expect(scenarioControl()).toHaveValue('A');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: /Samira Qureshi/})).toBeVisible();
  for (const program of programs) {
    const auditKey = rawKey(program === DEFAULT_PROGRAM ? 'audit' : `program.${program}.audit`);
    const audit = JSON.parse(morning[auditKey]);
    audit.value.generation = 1;
    morning[auditKey] = JSON.stringify(audit);
  }
  // All seed records and the original users/session bytes must survive; no journal remains.
  expect(rawStorage()).toEqual(morning);
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

it('lets only the facilitator reach Health or write settings', async () => {
  const store = createBrowserStore();
  expect(store.bootstrap().ok).toBe(true);
  expect(switchUser(store, PERSON.priya).ok).toBe(true);
  const before = rawStorage();
  expect(store.saveThresholds({...DEFAULT_THRESHOLDS, goodProbability: 98}, 'denied')).toMatchObject({ok: false, error: {code: 'FORBIDDEN'}});
  expect(rawStorage()).toEqual(before);
  render(<App />);
  expect(await screen.findByRole('heading', {name: 'Programs', level: 1})).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Service health is limited to the cluster administrator.');
  expect(window.location.pathname).toBe('/');
  expect(screen.queryByRole('link', {name: 'Service health'})).not.toBeInTheDocument();
  expect(rawStorage()).toEqual(before);
});

it.each([
  ['missing settings', null],
  ...['goodProbability', 'goodConfidence', 'attentionFrom', 'dispatchBelow', 'freshness'].map(field => {
    const settings = {...DEFAULT_THRESHOLDS};
    delete settings[field];
    return [`missing ${field}`, settings];
  }),
  ...['Permit', 'Civil', 'Power', 'Transmission', 'Material', 'Workforce'].map(field => {
    const freshness = {...DEFAULT_THRESHOLDS.freshness};
    delete freshness[field];
    return [`missing ${field} freshness`, {...DEFAULT_THRESHOLDS, freshness}];
  }),
  ['negative percentage', {...DEFAULT_THRESHOLDS, dispatchBelow: -1}],
  ['percentage above 100', {...DEFAULT_THRESHOLDS, goodProbability: 101}],
  ['fractional percentage', {...DEFAULT_THRESHOLDS, goodConfidence: 75.5}],
  ['numeric string percentage', {...DEFAULT_THRESHOLDS, attentionFrom: '50'}],
  ['non-finite percentage', {...DEFAULT_THRESHOLDS, dispatchBelow: Infinity}],
  ['attention above Good probability only', {...DEFAULT_THRESHOLDS, goodProbability: 49}],
  ['attention above Good confidence only', {...DEFAULT_THRESHOLDS, goodConfidence: 49}],
  ['negative freshness', {...DEFAULT_THRESHOLDS, freshness: {...DEFAULT_THRESHOLDS.freshness, Permit: -1}}],
  ['fractional freshness', {...DEFAULT_THRESHOLDS, freshness: {...DEFAULT_THRESHOLDS.freshness, Civil: 0.5}}],
  ['numeric string freshness', {...DEFAULT_THRESHOLDS, freshness: {...DEFAULT_THRESHOLDS.freshness, Power: '7'}}],
  ['unsafe freshness integer', {...DEFAULT_THRESHOLDS, freshness: {...DEFAULT_THRESHOLDS.freshness, Workforce: Number.MAX_SAFE_INTEGER + 1}}],
])('rejects %s without changing the persisted or published board', (_case, settings) => {
  const store = createBrowserStore();
  expect(store.bootstrap().ok).toBe(true);
  const before = rawStorage();
  const snapshot = store.getSnapshot();

  expect(store.saveThresholds(settings, 'invalid-thresholds')).toMatchObject({ok: false, error: {code: 'BAD_INPUT'}});
  expect(store.getSnapshot()).toBe(snapshot);
  expect(rawStorage()).toEqual(before);
});

it.each([
  [0, 0],
  [100, Number.MAX_SAFE_INTEGER],
])('persists percentage boundary %i and freshness boundary %i without changing other records', (percent, days) => {
  const store = createBrowserStore();
  expect(store.bootstrap().ok).toBe(true);
  const before = rawStorage();
  const program = stored('program');
  const thresholds = {goodProbability: percent, goodConfidence: percent, attentionFrom: percent, dispatchBelow: percent,
    freshness: {...DEFAULT_THRESHOLDS.freshness, Permit: days}};

  expect(store.saveThresholds(thresholds, 'boundary-thresholds').ok).toBe(true);
  expect(createBrowserStore().bootstrap().data.program.thresholds).toEqual(thresholds);
  expect(rawStorage()).toEqual({...before,
    [rawKey('program')]: JSON.stringify({schemaVersion: 1, value: {...program, thresholds}})});
});

it('explains an invalid threshold relationship to the facilitator and retains committed settings', async () => {
  const user = userEvent.setup();
  render(<App />);
  const before = rawStorage();
  const minimum = screen.getByRole('spinbutton', {name: 'Needs Attention minimum (%)'});
  await user.clear(minimum);
  await user.type(minimum, '76');
  expect(minimum).toBeValid();
  await user.click(screen.getByRole('button', {name: 'Save thresholds'}));

  expect(screen.getByText('Use whole numbers and keep the Needs Attention minimum at or below both Good thresholds.')).toBeVisible();
  expect(screen.queryByText('Thresholds saved. No new assessment was run.')).not.toBeInTheDocument();
  expect(rawStorage()).toEqual(before);
  await user.click(screen.getByRole('link', {name: 'Board', exact: true}));
  await user.click(screen.getByRole('link', {name: 'Service health'}));
  expect(screen.getByRole('spinbutton', {name: 'Needs Attention minimum (%)'})).toHaveValue(50);
});

it('relabels a scored site without modifying its score and restores settings across programs', async () => {
  const user = userEvent.setup();
  const east = createBrowserStore('east-bay');
  expect(east.bootstrap().ok).toBe(true);
  expect(east.saveThresholds({...DEFAULT_THRESHOLDS, goodProbability: 99}, 'east-thresholds').ok).toBe(true);
  const baselineScore = stored('program').lastScore;
  const baselineSites = stored('sites');
  const audit = stored('audit');
  render(<App />);
  const good = screen.getByRole('spinbutton', {name: 'Good probability (%)'});
  expect(good).toHaveValue(80);
  const fields = {'Good confidence (%)': 75, 'Needs Attention minimum (%)': 50, 'Dispatch minimum confidence (%)': 60,
    'Permit freshness (days)': 14, 'Civil freshness (days)': 7, 'Power freshness (days)': 7,
    'Transmission freshness (days)': 7, 'Material freshness (days)': 3, 'Workforce freshness (days)': 2};
  for (const [name, value] of Object.entries(fields)) expect(screen.getByRole('spinbutton', {name})).toHaveValue(value);
  await user.clear(good);
  await user.type(good, '95');
  const permitAge = screen.getByRole('spinbutton', {name: 'Permit freshness (days)'});
  await user.clear(permitAge);
  await user.type(permitAge, '0');
  await user.click(screen.getByRole('button', {name: 'Save thresholds'}));
  expect(stored('program').lastScore).toEqual(baselineScore);
  expect(stored('sites')).toEqual(baselineSites);
  expect(stored('audit')).toEqual(audit);
  expect(stored('program.east-bay.program').thresholds.goodProbability).toBe(99);
  await user.click(screen.getByRole('link', {name: 'Board', exact: true}));
  const register = within(screen.getByRole('table'));
  const civic = within(register.getByRole('link', {name: 'Civic Center', exact: true}).closest('tr'));
  expect(civic.getByText('Needs Attention')).toBeVisible();
  expect(civic.getByText('92%')).toBeVisible();
  await user.click(civic.getByRole('link', {name: 'Civic Center'}));
  const permitRow = within(screen.getByRole('table', {name: 'Evidence matrix'})).getByRole('rowheader', {name: /^Permit/}).closest('tr');
  expect(within(permitRow).getByRole('cell', {name: 'Stale', exact: true})).toBeVisible();
  expect(within(permitRow).getByText(/0-day threshold/)).toBeVisible();
  await user.click(screen.getByRole('link', {name: 'Service health'}));
  expect(screen.getByRole('spinbutton', {name: 'Good probability (%)'})).toHaveValue(95);
  const session = localStorage.getItem(rawKey('session'));
  await user.click(restoreOpener());
  expect(stored('program.east-bay.program').thresholds.goodProbability).toBe(99);
  await user.click(within(restoreDialog()).getByRole('button', {name: restoreTitle}));
  expect(screen.getByRole('spinbutton', {name: 'Good probability (%)'})).toHaveValue(80);
  expect(stored('program.east-bay.program').thresholds).toBeUndefined();
  expect(localStorage.getItem(rawKey('session'))).toBe(session);
});

it('blocks direct field execution on a configured confidence floor even with a matching approval', () => {
  const store = createBrowserStore();
  expect(store.bootstrap().ok).toBe(true);
  expect(store.saveThresholds({...DEFAULT_THRESHOLDS, dispatchBelow: 91}, 'raise-dispatch-floor').ok).toBe(true);
  expect(switchUser(store, PERSON.andre).ok).toBe(true);
  const board = store.getSnapshot();
  const site = board.sites['NRO-W-1847'];
  const field = previewField(board, site, readAccess(board));
  expect(field.approvals.dispatch).toBeTruthy();
  expect(field.reasons.dispatch).toContain('Dispatch requires at least 91% confidence.');
  expect(executeField(store, {...siteFence(store, board, site), commandId: 'blocked-attempt', action: 'dispatch',
    assignmentId: field.assignment.id, assignmentRev: field.assignment.rev, expectedFaultRev: board.faults.rev,
    approvalId: field.approvals.dispatch.id})).toMatchObject({ok: false, error: {code: 'FIELD_BLOCKED'}});
  expect(store.getSnapshot().sites[site.id].executions).toEqual([]);
});
