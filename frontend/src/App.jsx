/** Own the route tree, committed-board subscription and cross-page feedback. */
import {useEffect, useState, useSyncExternalStore} from 'react';
import PropTypes from 'prop-types';
import {BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams} from 'react-router-dom';
import {SharedShell} from './components/SharedShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import Portfolio from './pages/Portfolio.jsx';
import {continueAs, readAccess, resolveRoute, signIn, signOut, switchUser} from './utils/access.js';
import {createBrowserStore} from './utils/storage.js';

/** Host a route-specific recovery message without retaining an old board view. */
function MissingPage({title}) {
  return (
    <section className="card p-5">
      <h1 className="text-title font-semibold text-ink">{title}</h1>
      <Link className="mt-3 inline-block font-medium text-teal-ink underline" to="/">Back to Portfolio</Link>
    </section>
  );
}

MissingPage.propTypes = {title: PropTypes.string.isRequired};

/** Resolve an exact released identifier before mounting the site workspace. */
function ReleasedSite({board}) {
  const {siteId} = useParams();
  if (!Object.hasOwn(board.sites, siteId)) return <MissingPage title="Site not found" />;
  const site = board.sites[siteId];
  // Mount SiteWorkspace here with the validated site, the shared board/store, actor and notify.
  return (
    <header className="card p-5">
      <p className="meta">{site.id}</p>
      <h1 className="text-title font-semibold text-ink">{site.name}</h1>
      <p className="mt-1 text-muted">{site.neighborhood}</p>
    </header>
  );
}

ReleasedSite.propTypes = {board: PropTypes.object.isRequired};

/** Render protected content only from a validated committed snapshot. */
function BoardRoutes({store}) {
  const board = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [boot, setBoot] = useState(null);
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState(null);
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
    navigate(result.data.redirect, {replace: true});
  }

  if (!boot && !board) return (
    <main role="status" className="mx-auto max-w-5xl space-y-3 p-6">
      <span className="sr-only">Loading the readiness board</span>
      {[1, 2, 3, 4, 5].map(row => <div className="h-10 rounded-control bg-line motion-safe:animate-pulse" key={row} />)}
    </main>
  );
  if (!board) return (
    <main className="mx-auto max-w-lg p-6">
      <section className="card space-y-3 p-5" aria-labelledby="board-unavailable">
        <h1 id="board-unavailable" className="text-title font-semibold text-ink">Board unavailable</h1>
        <p role="alert">{boot?.error?.message ?? 'Ask the cluster administrator to restore the morning board.'}</p>
        <button type="button" className="btn" onClick={() => setBoot(store.recover())}>Try again</button>
      </section>
    </main>
  );

  const decision = resolveRoute(location.pathname, actor);
  if (decision) return <Navigate replace to={decision.to} state={decision.message ? {message: decision.message} : undefined} />;
  if (!actor) return <LoginPage onSignIn={input => signIn(store, input)} onContinue={id => continueAs(store, id)} />;

  // The recovery slice can supply sourceStatus and onRestore to SharedShell, mount the
  // same restore dialog here, and replace the authorized Service Health route's header.
  return (
    <SharedShell key={`${store.getSessionEpoch()}:${board.audit.generation}`} board={board} actor={actor} query={query} onQuery={setQuery}
      onSwitch={id => changeAccess(switchUser(store, id))} onSignOut={() => changeAccess(signOut(store))}>
      {location.state?.message && <p role="status" className="mb-3 rounded-control border border-line bg-card px-3 py-2">{location.state.message}</p>}
      <Routes>
        <Route path="/" element={<Portfolio board={board} actor={actor} query={query} />} />
        <Route path="/sites/:siteId" element={<ReleasedSite board={board} />} />
        <Route path="/service-health" element={
          <h1 className="text-title font-semibold text-ink">Service health</h1>
        } />
        <Route path="*" element={<MissingPage title="Page not found" />} />
      </Routes>
      <div aria-live="polite" className="fixed bottom-4 right-4 z-30 max-w-[min(24rem,calc(100vw-2rem))]">
        {feedback && (
          <div className={`card flex items-center gap-3 px-4 py-3 shadow-sm ${feedback.kind === 'error' ? 'text-red' : 'text-teal-ink'}`}>
            <p>{feedback.message}</p>
            {feedback.kind === 'error' && <button type="button" className="btn" onClick={() => setFeedback(null)}>Dismiss</button>}
          </div>
        )}
      </div>
    </SharedShell>
  );
}

BoardRoutes.propTypes = {store: PropTypes.object.isRequired};

/** Mount the board in one browser router and obtain storage only through its adapter. */
export default function App() {
  const [store] = useState(createBrowserStore);
  return (
    <BrowserRouter future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
      <BoardRoutes store={store} />
    </BrowserRouter>
  );
}
