/** Project browser-local source health and commit facilitator workshop controls. */
import {BOARD_AT} from '../data/register.js';
import {authorize, INTENT} from '../utils/access.js';
import {assessmentIsDown, civilMillis} from '../utils/readiness.js';
import {commandError} from './evidence.js';

const SHELL_SOURCES = ['DPAM', 'POS', 'DDL', 'ECO'];
const SOURCE_IDS = [...SHELL_SOURCES, 'City portal', 'Northwind Power feed', 'Assessment'];
const SOURCE_SCOPE = Object.freeze({DPAM: 'Site activity and civil evidence', POS: 'Plans and approvals',
  DDL: 'Transmission and material evidence', ECO: 'Local workflow records', 'City portal': 'Permit evidence',
  'Northwind Power feed': 'Power evidence', Assessment: 'Local assessment replay'});

export const SCENARIOS = Object.freeze({A: 'Normal', B: 'Exception', C: 'Consequential decision', D: 'Service interruption'});
export const PORTSIDE_APPROVAL = '/sites/NRO-W-1866?tab=approval';
export const RESTORE_TITLE = 'Restore morning snapshot';

/** Overlay simulated outages without replacing the last successful sync or source evidence. */
export function readSources(program, faults) {
  return SOURCE_IDS.map(sourceId => {
    const item = {...program.sources[sourceId], scope: SOURCE_SCOPE[sourceId]};
    if (sourceId === 'DDL') return {...item, state: faults.scenarioDdlDown ? 'Down' : faults.ddlOverride ?? item.state};
    if (sourceId !== 'Assessment') return item;
    const down = assessmentIsDown(faults);
    const lastSyncAt = program.lastScore.scoredAt ?? item.lastSyncAt;
    return {...item, state: down ? 'Down' : item.state, lastSyncAt,
      detail: down ? 'No new score returned while the service is down.' : lastSyncAt ? `Last score ${lastSyncAt.slice(11, 16)}.` : 'No successful score recorded.'};
  });
}

/** Reuse the health view's rows and compute shell sync age against the fixed board clock. */
export function selectShellHealth(sources) {
  const items = sources.filter(item => SHELL_SOURCES.includes(item.sourceId));
  const newest = items.map(item => item.lastSyncAt).filter(Boolean).sort().at(-1);
  const age = newest ? Math.max(0, Math.floor((civilMillis(BOARD_AT) - civilMillis(newest)) / 60000)) : null;
  return {items, age};
}

/** Fence a workshop mutation and recheck the persisted persona before replay or commit. */
function controlCommand(store, input, intent, intentKey) {
  const board = store.getSnapshot();
  const {commandId, expectedGeneration = board?.audit.generation,
    expectedSessionToken = board?.session?.token ?? null, expectedSessionEpoch = store.getSessionEpoch()} = input;
  return {commandId, intentKey, expectedGeneration, expectedSessionToken, expectedSessionEpoch,
    authorize: (_board, actor) => authorize(actor, intent)};
}

/** Start the retry budget on a new effective outage; preserve it across ownership changes. */
function transitionFaults(before, overrides) {
  if (Object.entries(overrides).every(([name, value]) => before[name] === value)) return before;
  const next = {...before, ...overrides, rev: before.rev + 1};
  next.retryFailuresRemaining = !assessmentIsDown(next) ? 0 : assessmentIsDown(before) ? before.retryFailuresRemaining : 1;
  return next;
}

/** Set one manual override and return the effective source status after commit. */
export function setFault(store, input = {}) {
  const {source, state} = input;
  if (!['DDL', 'Assessment'].includes(source) || !['Up', 'Down'].includes(state)) {
    return commandError('BAD_INPUT', 'Choose Up or Down for DDL or the assessment service.');
  }
  return store.commit(controlCommand(store, input, INTENT.health, `fault:${source}:${state}`), board => {
    const overrides = source === 'DDL' ? {ddlOverride: state} : {assessmentDown: state === 'Down'};
    const faults = transitionFaults(board.faults, overrides);
    const effective = readSources(board.program, faults).find(row => row.sourceId === source);
    return {writes: faults === board.faults ? {} : {faults},
      result: {source, state: effective.state, lastSyncAt: effective.lastSyncAt}};
  });
}

/** Select a workshop scenario without rewinding evidence, decisions, or manual faults. */
export function selectScenario(store, input = {}) {
  const {scenario} = input;
  if (typeof scenario !== 'string' || !Object.hasOwn(SCENARIOS, scenario)) {
    return commandError('BAD_INPUT', 'Choose a workshop scenario.');
  }
  return store.commit(controlCommand(store, input, INTENT.scenario, `scenario:${scenario}`), board => {
    const changed = scenario !== board.scenario;
    const faults = changed ? transitionFaults(board.faults, {scenarioAssessmentDown: scenario === 'D',
      scenarioDdlDown: scenario === 'D', forceLowConfidence: scenario === 'B'}) : board.faults;
    const writes = changed ? {scenario} : {};
    if (faults !== board.faults) writes.faults = faults;
    return {writes, result: {label: SCENARIOS[scenario], navigateTo: scenario === 'C' ? PORTSIDE_APPROVAL : null}};
  });
}

/** Run the same journaled restore command from either opener or the recovery screen. */
export function restoreMorning(store, input) {
  return store.restore(input);
}
