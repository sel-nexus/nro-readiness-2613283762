/** Verify persona policy and session-only writes against the real board store. */
import {webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PERSON} from '../src/data/people.js';
import {createStore, STORAGE_PREFIX} from '../src/utils/storage.js';
import {accounts, authorize, continueAs, HEALTH_DENIED, INTENT, readAccess, resolveRoute, signIn, signOut, switchUser} from '../src/utils/access.js';

/** Open an isolated synchronous storage adapter with the canonical baseline. */
function setup() {
  const values = new Map();
  const adapter = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
  const store = createStore(adapter);
  expect(store.bootstrap().ok).toBe(true);
  return {store, adapter, values};
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('workshop access', () => {
  it.each(accounts)('accepts exact seeded credentials for $name and normalizes email alone', async ({id, email, name, role}) => {
    const {store} = setup();
    const password = `Nr0-${name.split(' ')[0]}#1842`;
    expect(await signIn(store, {email: `  ${email.toUpperCase()}  `, password})).toEqual({ok: true, data: {userId: id, role, redirect: '/'}});
    expect(readAccess(store.getSnapshot())).toMatchObject({id, name, role, email});
    expect(readAccess(store.getSnapshot())).not.toHaveProperty('credentialVerifier');
    expect(readAccess(store.getSnapshot())).not.toHaveProperty('token');
  });

  it('makes wrong passwords, whitespace changes and unknown accounts indistinguishable without writes', async () => {
    const {store, values} = setup();
    const before = [...values];
    const good = `Nr0-${accounts[0].name.split(' ')[0]}#1842`;
    const result = {ok: false, error: {code: 'BAD_LOGIN', message: 'Email or password is incorrect.'}};
    expect(await signIn(store, {email: accounts[0].email, password: ` ${good}`})).toEqual(result);
    expect(await signIn(store, {email: 'unknown@example.invalid', password: good})).toEqual(result);
    expect(await signIn(store, {email: accounts[0].email, password: 'incorrect'})).toEqual(result);
    expect([...values]).toEqual(before);
  });

  it('continues, switches, reopens and signs out without changing any board record', () => {
    const {store, adapter, values} = setup();
    const before = [...values];
    const tokens = new Set();
    expect(switchUser(store, PERSON.samira).ok).toBe(false);
    expect(continueAs(store, PERSON.luis).ok).toBe(false);
    expect(continueAs(store, PERSON.priya).ok).toBe(true);
    tokens.add(store.getSnapshot().session.token);
    const epoch = store.getSessionEpoch();
    for (const {id} of accounts.filter(account => account.id !== PERSON.priya)) {
      expect(switchUser(store, id).ok).toBe(true);
      tokens.add(store.getSnapshot().session.token);
      expect(readAccess(store.getSnapshot()).id).toBe(id);
    }
    expect(tokens.size).toBe(6);
    expect(store.getSessionEpoch()).toBe(epoch + 5);
    expect(continueAs(store, PERSON.jordan).ok).toBe(false);
    const reopened = createStore(adapter);
    expect(reopened.bootstrap().ok).toBe(true);
    expect(readAccess(reopened.getSnapshot()).id).toBe(PERSON.samira);
    expect(values.has(`${STORAGE_PREFIX}session`)).toBe(true);
    expect(signOut(reopened)).toEqual({ok: true, data: {redirect: '/login'}});
    expect(readAccess(reopened.getSnapshot())).toBeNull();
    expect([...values]).toEqual(before);
  });

  it('fails closed on malformed sessions, counterfeit roles and unknown intents', () => {
    const {store} = setup();
    expect(continueAs(store, PERSON.jordan).ok).toBe(true);
    const board = store.getSnapshot();
    expect(readAccess({...board, session: {...board.session, userId: PERSON.luis}})).toBeNull();
    expect(readAccess({...board, session: {...board.session, token: ''}})).toBeNull();
    expect(readAccess({...board, session: {...board.session, role: 'Approver'}})).toBeNull();
    expect(authorize({id: PERSON.jordan, role: 'Approver'}, INTENT.approve)).toBe(false);
    expect(authorize(readAccess(board), 'publish')).toBe(false);
  });

  it('does not announce a failed session write or invalidate the current actor', () => {
    const {store, adapter, values} = setup();
    expect(continueAs(store, PERSON.marcus).ok).toBe(true);
    const before = [...values];
    const epoch = store.getSessionEpoch();
    const write = adapter.setItem;
    let interrupt = true;
    adapter.setItem = (key, value) => {
      if (key.endsWith('.session') && interrupt) {
        interrupt = false;
        throw new Error('Storage write interrupted');
      }
      return write(key, value);
    };
    expect(switchUser(store, PERSON.samira)).toMatchObject({ok: false, error: {code: 'STORAGE_WRITE'}});
    expect(readAccess(store.getSnapshot()).id).toBe(PERSON.marcus);
    expect(store.getSessionEpoch()).toBe(epoch);
    expect([...values]).toEqual(before);
  });

  it('enforces named-persona permission before site eligibility and redirects denied routes', () => {
    const allowed = {
      read: accounts.map(account => account.id), evidence: [PERSON.marcus, PERSON.elena, PERSON.andre],
      attach: [PERSON.marcus, PERSON.elena, PERSON.andre], assign: [PERSON.marcus, PERSON.elena, PERSON.andre],
      precautionaryHold: [PERSON.marcus, PERSON.elena, PERSON.andre], refresh: [PERSON.marcus, PERSON.elena, PERSON.andre],
      assess: accounts.map(account => account.id).filter(id => id !== PERSON.jordan), retry: accounts.map(account => account.id).filter(id => id !== PERSON.jordan),
      approve: [PERSON.priya], reject: [PERSON.priya], modify: [PERSON.priya], override: [PERSON.priya],
      dispatch: [PERSON.andre], fieldHold: [PERSON.andre], resequence: [PERSON.andre], health: [PERSON.samira], scenario: [PERSON.samira], restore: [PERSON.samira],
    };
    for (const actor of accounts) {
      for (const intent of Object.values(INTENT)) expect(authorize(actor, intent)).toBe(allowed[intent].includes(actor.id));
      expect(resolveRoute('/sites/NRO-W-1842', actor)).toBeNull();
      expect(resolveRoute('/login', actor)).toEqual({to: '/'});
      expect(resolveRoute('/service-health', actor)).toEqual(actor.id === PERSON.samira ? null : {to: '/', message: HEALTH_DENIED});
    }
    expect(resolveRoute('/login', null)).toBeNull();
    expect(resolveRoute('/sites/NRO-W-1842', null)).toEqual({to: '/login'});
    expect(resolveRoute('/service-health', null)).toEqual({to: '/login'});
    expect(resolveRoute('/SERVICE-HEALTH/', accounts.find(actor => actor.id === PERSON.jordan))).toEqual({to: '/', message: HEALTH_DENIED});
    expect(resolveRoute('/%73ervice-health', accounts.find(actor => actor.id === PERSON.jordan))).toEqual({to: '/', message: HEALTH_DENIED});
  });
});
