/** Resolve workshop identities and commit session-only transitions. */
import {PERSON, USERS} from '../data/people.js';
import {BOARD_AT} from '../data/register.js';

export const HEALTH_DENIED = 'Service health is limited to the cluster administrator.';
const BAD_LOGIN = 'Email or password is incorrect.';
export const INTENT = Object.freeze({read: 'read', evidence: 'evidence', attach: 'attach', assign: 'assign',
  precautionaryHold: 'precautionaryHold', refresh: 'refresh', assess: 'assess', retry: 'retry',
  approve: 'approve', reject: 'reject', modify: 'modify', override: 'override', dispatch: 'dispatch',
  fieldHold: 'fieldHold', resequence: 'resequence', health: 'health', scenario: 'scenario', restore: 'restore'});

/** Return a display-safe account selection without session or credential fields. */
function publicAccount({id, name, title, role, email, employeeId, phone}) {
  return {id, userId: id, name, title, role, email, employeeId, phone};
}

export const accounts = Object.freeze(Object.values(USERS).map(user => Object.freeze(publicAccount(user))));

/** Use the committed session only if it identifies an actual seeded user. */
export function readAccess(board) {
  const session = board?.session;
  if (!session || typeof session.token !== 'string' || !session.token || !Object.hasOwn(USERS, session.userId)
    || typeof session.signedInAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(session.signedInAt)) return null;
  const user = board.users?.[session.userId];
  return user?.id === session.userId && user.role === USERS[session.userId].role && user.role === session.role
    ? publicAccount(USERS[session.userId]) : null;
}

/** Check persona scope before any site-specific eligibility checks. */
export function authorize(actor, intent) {
  const id = actor?.id ?? actor?.userId;
  if (!Object.hasOwn(USERS, id) || USERS[id].role !== actor.role) return false;
  const operator = USERS[id].role === 'Operator';
  switch (intent) {
    case INTENT.read: return true;
    case INTENT.evidence: case INTENT.attach: case INTENT.assign: case INTENT.precautionaryHold: case INTENT.refresh:
      return operator;
    case INTENT.assess: case INTENT.retry: return operator || id === PERSON.priya || id === PERSON.samira;
    case INTENT.approve: case INTENT.reject: case INTENT.modify: case INTENT.override: return id === PERSON.priya;
    case INTENT.dispatch: case INTENT.fieldHold: case INTENT.resequence: return id === PERSON.andre;
    case INTENT.health: case INTENT.scenario: case INTENT.restore: return id === PERSON.samira;
    default: return false;
  }
}

/** Resolve a route's access before any protected content is mounted. */
export function resolveRoute(path, actor) {
  let normalized = path;
  try { normalized = decodeURI(path); } catch { /* Malformed paths fall through to not-found. */ }
  const route = normalized.replace(/\/+$/, '').toLowerCase() || '/';
  if (route === '/login') return authorize(actor, INTENT.read) ? {to: '/'} : null;
  if (!authorize(actor, INTENT.read)) return {to: '/login'};
  if (route === '/service-health' && !authorize(actor, INTENT.health)) return {to: '/', message: HEALTH_DENIED};
  return null;
}

/** Join all name initials for compact identity labels. */
export const initials = name => name.split(' ').map(part => part[0]).join('');

/** Return a redacted access failure without retaining request inputs. */
const fail = (code, message) => ({ok: false, error: {code, message}});

/** Persist only a new session, enforcing the current access fence under the store guard. */
function enter(store, userId, mode, expectedSessionToken) {
  if (!Object.hasOwn(USERS, userId)) return fail('FORBIDDEN', 'Choose a West Metro team member.');
  try {
    const token = `sess_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')}`;
    return store.commit({commandId: mode, sessionOnly: true, expectedSessionToken}, (board, actor) => {
      if (mode === 'switchUser' ? !actor : actor) return fail('FORBIDDEN', 'Access changed. Try again.');
      const role = board.users[userId].role;
      return {writes: {session: {userId, role, token, signedInAt: BOARD_AT}}, result: {userId, role, redirect: '/'}};
    });
  } catch {
    return fail('ACCESS_UNAVAILABLE', 'Could not start a session. Try again.');
  }
}

/** Verify the exact password after normalizing only the supplied email. */
export async function signIn(store, {email, password} = {}) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized || typeof password !== 'string') return fail('BAD_LOGIN', BAD_LOGIN);
  const user = Object.values(USERS).find(entry => entry.email === normalized);
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    const verifier = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (!user || verifier !== user.credentialVerifier) return fail('BAD_LOGIN', BAD_LOGIN);
    return enter(store, user.id, 'signIn', null);
  } catch {
    return fail('ACCESS_UNAVAILABLE', 'Could not verify credentials. Use Continue or try again.');
  }
}

/** Enter from the signed-out team's account list. */
export const continueAs = (store, userId) => enter(store, userId, 'continueAs', null);

/** Replace the current persona without copying or changing board records. */
export function switchUser(store, userId) {
  const token = store.getSnapshot()?.session?.token;
  return token ? enter(store, userId, 'switchUser', token) : fail('FORBIDDEN', 'Sign in before switching users.');
}

/** Remove only the session and release navigation after the write commits. */
export function signOut(store) {
  return store.commit({commandId: 'signOut', sessionOnly: true, expectedSessionToken: store.getSnapshot()?.session?.token ?? null},
    () => ({writes: {session: null}, result: {redirect: '/login'}}));
}
