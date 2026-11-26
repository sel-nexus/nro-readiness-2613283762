/** Own the route tree, committed-board subscription and cross-page feedback. */
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import PropTypes from 'prop-types';
import {BrowserRouter, Link, Navigate, Route, Routes, matchPath, useLocation, useNavigate, useParams} from 'react-router-dom';
import {ApprovalDraftScope, ApprovalQueue} from './components/ApprovalPanel.jsx';
import {SharedShell} from './components/SharedShell.jsx';
import {ProgramActivity, ProgramSchedule} from './components/ProgramPanels.jsx';
import {RestoreDialog} from './components/RestoreDialog.jsx';
import LoginPage from './pages/LoginPage.jsx';
import Portfolio, {ProgramBoard} from './pages/Portfolio.jsx';
import {DEFAULT_PROGRAM, PROGRAMS, programPath, siteProgram} from './data/programs.js';
import ServiceHealth from './pages/ServiceHealth.jsx';
import SiteWorkspace from './pages/SiteWorkspace.jsx';
import {readSources, RESTORE_TITLE, selectShellHealth} from './services/sources.js';
import {continueAs, readAccess, resolveRoute, signIn, signOut, switchUser} from './utils/access.js';
import {createBrowserStore} from './utils/storage.js';

/** Host a route-specific recovery message without retaining an old board view. */
function MissingPage({title}) {
  return (
    <section className="card p-5">
      <h1 className="text-title font-semibold text-ink">{title}</h1>
      <Link className="btn mt-3" to="/">Back to Programs</Link>
    </section>
  );
}

MissingPage.propTypes = {title: PropTypes.string.isRequired};

/** Resolve an exact released identifier before mounting the site workspace. */
function ReleasedSite({board, actor, store, notify}) {
  const {siteId} = useParams();
  if (!Object.hasOwn(board.sites, siteId)) return <MissingPage title="Site not found" />;
  const site = board.sites[siteId];
  return (
    <ApprovalDraftScope key={siteId}>
      <SiteWorkspace board={board} site={site} actor={actor} store={store} notify={notify} />
    </ApprovalDraftScope>
  );
}

ReleasedSite.propTypes = {board: PropTypes.object.isRequired, actor: PropTypes.object.isRequired,
  store: PropTypes.object.isRequired, notify: PropTypes.func.isRequired};

/** Resolve one scope from the URL and reject conflicting site and program parameters. */
function programFromLocation({pathname, search}) {
  const rawSite = matchPath('/sites/:siteId', pathname)?.params.siteId;
  let inferred;
  try { if (rawSite) inferred = siteProgram(decodeURIComponent(rawSite)); } catch { return null; }
  const values = new URLSearchParams(search).getAll('program');
  if (!values.length) return inferred || DEFAULT_PROGRAM;
  const [explicit] = values;
  return values.length === 1 && Object.hasOwn(PROGRAMS, explicit) && (!inferred || inferred === explicit) ? explicit : null;
}

/** Resolve shared access before creating or opening a secondary program store. */
function ProgramAccess({accessStore}) {
  const location = useLocation();
  const access = useSyncExternalStore(accessStore.subscribe, accessStore.getSnapshot);
  const actor = readAccess(access);
  const programId = programFromLocation(location);
  const allowed = actor && !resolveRoute(location.pathname, actor);
  const scope = allowed && programId ? programId : DEFAULT_PROGRAM;
  return <BoardRoutes key={scope} accessStore={accessStore} programId={scope} validProgram={programId !== null} />;
}

ProgramAccess.propTypes = {accessStore: PropTypes.object.isRequired};

/** Render protected content only from a validated committed snapshot in the requested scope. */
function BoardRoutes({accessStore, programId, validProgram}) {
  const [store] = useState(() => programId === DEFAULT_PROGRAM ? accessStore : createBrowserStore(programId));
  const board = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [boot, setBoot] = useState(null);
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [restoreIntent, setRestoreIntent] = useState(null);
  const restoreOpener = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const actor = readAccess(board);

  useEffect(() => { setBoot(store.bootstrap()); }, [store]);
  useEffect(() => {
    if (feedback?.kind !== 'success') return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  /** Share committed success and durable error feedback with other route components. */
  function notify(kind, message) {
    setFeedback({kind, message});
  }

  /** Change persona or sign out, then clear transient UI state and replace history. */
  function changeAccess(result) {
    if (!result.ok) { notify('error', result.error.message); return; }
    setQuery('');
    setFeedback(null);
    setRestoreIntent(null);
    navigate(result.data.redirect, {replace: true});
  }

  /** Open confirmation only for a valid persisted administrator session. */
  function openRestore(opener) {
    const intent = accessStore.getRestoreIntent();
    if (!intent) { notify('error', 'Only the cluster administrator can restore the morning board.'); return; }
    restoreOpener.current = opener;
    setRestoreIntent(intent);
  }

  /** Restore focus to the entry point, or the refreshed board after a reset. */
  function closeRestore() {
    const opener = restoreOpener.current;
    restoreOpener.current = null;
    setRestoreIntent(null);
    window.requestAnimationFrame(() => {
      (opener?.isConnected ? opener : document.getElementById('main-content'))?.focus();
    });
  }

  if (!boot && !board) return (
    <main role="status" className="mx-auto max-w-5xl space-y-3 p-6">
      <span className="sr-only">Loading the readiness board</span>
      {[1, 2, 3, 4, 5].map(row => <div className="h-10 rounded-control bg-line motion-safe:animate-pulse" key={row} />)}
    </main>
  );
  const decision = board && resolveRoute(location.pathname, actor);
  if (decision) return <Navigate replace to={decision.to} state={decision.message ? {message: decision.message} : undefined} />;
  if (!actor && board) return <LoginPage onSignIn={input => signIn(accessStore, input)} onContinue={id => continueAs(accessStore, id)} />;
  const sources = board ? readSources(board.program, board.faults) : [];
  return (
    <>
      {!board ? (
        <main className="mx-auto max-w-lg p-6">
          <section className="card space-y-3 p-5" aria-labelledby="board-unavailable">
            <h1 id="board-unavailable" className="text-title font-semibold text-ink">Board unavailable</h1>
            <p role="alert">{boot?.error?.message ?? 'Ask the cluster administrator to restore the morning board.'}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => setBoot(store.recover())}>Try again</button>
              {accessStore.getRestoreIntent() && (
                <button type="button" className="btn" onClick={event => openRestore(event.currentTarget)}>{RESTORE_TITLE}…</button>
              )}
            </div>
          </section>
        </main>
      ) : (
        <SharedShell key={`${store.getSessionEpoch()}:${board.audit.generation}`} board={board} actor={actor} programId={programId} query={query} onQuery={setQuery}
          sourceStatus={selectShellHealth(sources)} onRestore={openRestore}
          onSwitch={id => changeAccess(switchUser(accessStore, id))} onSignOut={() => changeAccess(signOut(accessStore))}>
          {location.state?.message && <p role="status" className="mb-3 rounded-control border border-line bg-card px-3 py-2">{location.state.message}</p>}
          {!validProgram ? <MissingPage title="Program not found" /> : <Routes>
            <Route path="/" element={<Portfolio />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/board" element={<ProgramBoard board={board} programId={programId} query={query} />} />
            <Route path="/schedule" element={<ProgramSchedule board={board} schedulePath={programPath('/schedule', programId)}
              atStake={new URLSearchParams(location.search).get('view') === 'at-stake'} />} />
            <Route path="/activity" element={<ProgramActivity board={board} />} />
            <Route path="/approvals" element={
              <ApprovalQueue board={board} actor={actor} store={store} notify={notify} />
            } />
            <Route path="/sites/:siteId" element={
              <ReleasedSite board={board} actor={actor} store={store} notify={notify} />
            } />
            <Route path="/service-health" element={
              <ServiceHealth board={board} sources={sources} store={store} notify={notify} onRestore={openRestore} />
            } />
            <Route path="*" element={<MissingPage title="Page not found" />} />
          </Routes>}
        </SharedShell>
      )}
      {restoreIntent && <RestoreDialog store={accessStore} intent={restoreIntent} onDismiss={closeRestore} onRestored={() => {
        if (store !== accessStore) setBoot(store.recover());
        setQuery('');
        notify('success', 'Morning snapshot restored');
      }} />}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-30 max-w-[min(24rem,calc(100vw-2rem))]">
        {feedback && (
          <div className={`card flex items-center gap-3 px-4 py-3 shadow-sm ${feedback.kind === 'error' ? 'text-red' : 'text-teal-ink'}`}>
            <p>{feedback.message}</p>
            {feedback.kind === 'error' && <button type="button" className="btn" onClick={() => setFeedback(null)}>Dismiss</button>}
          </div>
        )}
      </div>
    </>
  );
}

BoardRoutes.propTypes = {accessStore: PropTypes.object.isRequired, programId: PropTypes.string.isRequired, validProgram: PropTypes.bool.isRequired};

/** Mount the board in one browser router and obtain storage only through its adapter. */
export default function App() {
  const [store] = useState(createBrowserStore);
  return (
    <BrowserRouter future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
      <ProgramAccess accessStore={store} />
    </BrowserRouter>
  );
}
