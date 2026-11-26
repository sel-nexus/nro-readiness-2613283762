/** Present common signed-in navigation, account actions and read-only board signals. */
import {useEffect, useRef, useState} from 'react';
import PropTypes from 'prop-types';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {Icon} from './icons.jsx';
import {accounts, authorize, initials, INTENT} from '../utils/access.js';
import {formatDate, orderedNotices, searchSites, sitePath} from '../utils/portfolio.js';

import {PROGRAMS, programPath} from '../data/programs.js';

const navigation = [['/', 'Programs'], ['/board', 'Board'], ['/schedule', 'Schedule'], ['/activity', 'Activity'],
  ['/approvals', 'Approvals'], ['/service-health', 'Service health']];
const searchLabel = 'Search site id or name';
const dot = {Up: 'bg-teal', Delayed: 'bg-amber', Down: 'bg-red'};

/** Render signed-in controls and their route-specific search behavior.
 *
 * Args:
 *   sourceStatus: Shared health-adapter projection with items and age.
 *   onRestore: Optional callback receiving the opener for the shared restore dialog.
 *   onSwitch, onSignOut: Commit session changes and navigate only on success.
 */
export function SharedShell({board, actor, programId, query, onQuery, onSwitch, onSignOut, onRestore, sourceStatus, children}) {
  const {pathname} = useLocation();
  const navigate = useNavigate();
  const isSite = pathname.toLowerCase().startsWith('/sites/');
  const route = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  const isPrograms = route === '/' || route === '/portfolio';
  const isBoard = route === '/board';
  const admin = authorize(actor, INTENT.health);
  const [panel, setPanel] = useState(null);
  const [lookup, setLookup] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [selected, setSelected] = useState(-1);
  const guide = useRef(null);
  const guideOpen = useRef(false);
  const searchBox = useRef(null);
  const popovers = useRef(null);
  const accountButton = useRef(null);
  const noticeButton = useRef(null);
  const allNotices = orderedNotices(board.program.notices);
  const unread = allNotices.filter(notice => notice.unread).length;
  const {items, age} = sourceStatus;
  const searchValue = isBoard ? query : lookup;
  const matches = searchValue.trim() ? searchSites(board.sites, searchValue) : [];
  const listOpen = suggesting && !!searchValue.trim();

  useEffect(() => {
    setPanel(null);
    setLookup('');
    setSuggesting(false);
    setSelected(-1);
    onQuery('');
  }, [pathname, onQuery]);

  useEffect(() => {
    /** Close disclosures when interacting outside them. */
    function outside(event) {
      if (!popovers.current?.contains(event.target)) setPanel(null);
      if (!searchBox.current?.contains(event.target)) setSuggesting(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);

  /** Open a matching site and close the suggestions without guessing on ambiguity. */
  function openResult(site) {
    setSuggesting(false);
    setSelected(-1);
    navigate(sitePath(site.id));
  }

  /** Keep keyboard selection on the input and expose the active result. */
  function searchKeys(event) {
    if (event.key === 'Escape') {
      if (listOpen) event.stopPropagation();
      setSuggesting(false);
      setSelected(-1);
    } else if (['ArrowDown', 'ArrowUp'].includes(event.key) && matches.length) {
      event.preventDefault();
      setSuggesting(true);
      setSelected(index => index < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
        : (index + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
    } else if (event.key === 'Enter' && searchValue.trim()) {
      event.preventDefault();
      const result = matches[selected] ?? (matches.length === 1 ? matches[0] : null);
      if (result) openResult(result);
      else setSuggesting(true);
    }
  }

  /** Restore focus when dismissing either of the shell disclosures. */
  function closePanel() {
    (panel === 'notices' ? noticeButton : accountButton).current?.focus();
    setPanel(null);
  }

  /** Open the focus-trapping guide; shared dialog styles lock background scrolling. */
  function openGuide() {
    setPanel(null);
    guide.current.showModal();
    guideOpen.current = true;
  }

  return (
    <>
      <a className="sr-only focus:not-sr-only" href="#main-content">Skip to content</a>
      <header className="shell-header relative z-20 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 xl:px-6">
        <Link to={programPath('/', programId)} className="flex shrink-0 items-center gap-2 font-semibold text-ink">
          <span className="grid size-8 place-items-center rounded-control bg-ink text-white">
            <Icon name="logo" />
          </span>
          NRO Readiness
        </Link>
        <div className="min-w-0 max-w-full">
          <label className="sr-only" htmlFor="active-program">Active program</label>
          <select id="active-program" className="field w-full" value={programId}
            onChange={event => navigate(programPath(isSite ? '/board' : route, event.target.value))}>
            {Object.entries(PROGRAMS).map(([id, program]) => <option key={id} value={id}>{program.name}</option>)}
          </select>
        </div>
        <div
          ref={searchBox}
          className="relative order-last min-w-0 basis-full xl:order-none xl:flex-1 xl:basis-auto"
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSuggesting(false);
          }}
        >
          <label htmlFor="site-search" className="sr-only">{searchLabel}</label>
          <Icon name="search" className="pointer-events-none absolute left-3 top-2.5 text-muted" />
          <input
            id="site-search"
            className="field w-full !pl-9"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listOpen ? 'site-suggestions' : undefined}
            aria-activedescendant={listOpen && matches[selected] ? `search-result-${selected}` : undefined}
            placeholder={searchLabel}
            value={searchValue}
            onFocus={() => setSuggesting(true)}
            onChange={event => {
              (isBoard ? onQuery : setLookup)(event.target.value);
              setSuggesting(true);
              setSelected(-1);
            }}
            onKeyDown={searchKeys}
          />
          {listOpen && (
            <div className="card absolute top-full z-30 mt-1 max-h-64 w-full overflow-y-auto shadow-sm">
              <ul id="site-suggestions" role="listbox" aria-label="Matching sites">
                {matches.map((site, index) => (
                  <li
                    id={`search-result-${index}`}
                    key={site.id}
                    role="option"
                    aria-selected={selected === index}
                    className={selected === index ? 'bg-green-wash' : ''}
                  >
                    <Link
                      tabIndex={-1}
                      className="block border-b border-line px-3 py-2 hover:bg-surface"
                      to={sitePath(site.id)}
                      onClick={() => setSuggesting(false)}
                    >
                      {site.name} · {site.id}
                    </Link>
                  </li>
                ))}
              </ul>
              {!matches.length && <p role="status" className="px-3 py-2 text-muted">No site matches that name in {board.program.cluster}.</p>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Source status">
          {items.map(({sourceId, state, lastSyncAt}) => (
            <div key={sourceId} className="group relative">
              <button
                type="button"
                className="flex min-h-8 items-center gap-1 px-1 text-meta"
                aria-label={`${sourceId} · ${state} · ${lastSyncAt ? `synced ${lastSyncAt.slice(11, 16)}` : 'No sync recorded'}`}
              >
                <span className={`size-2 rounded-full ${dot[state]}`} aria-hidden="true" />
                {sourceId}
              </button>
              <span
                aria-hidden="true"
                className={'card pointer-events-none absolute right-0 top-full z-40 hidden whitespace-nowrap px-2 py-1 text-meta shadow-sm ' +
                  'group-hover:block group-focus-within:block'}
              >
                {state} · {lastSyncAt ? `synced ${formatDate(lastSyncAt, true)}` : 'No sync recorded'}
              </span>
            </div>
          ))}
          {age !== null && <p className="meta">Sources synced {age} min ago</p>}
        </div>
        <div ref={popovers} className="relative ml-auto flex items-center gap-2" onKeyDown={event => { if (event.key === 'Escape' && panel) closePanel(); }}>
          <div>
            <button
              type="button"
              ref={noticeButton}
              className="btn"
              aria-label={`Notifications, ${unread} unread`}
              aria-expanded={panel === 'notices'}
              aria-controls={panel === 'notices' ? 'notices-panel' : undefined}
              onClick={() => setPanel(panel === 'notices' ? null : 'notices')}
            >
              <Icon name="bell" />
              <span aria-hidden="true" className="font-semibold">{unread}</span>
            </button>
            {panel === 'notices' && (
              <section
                id="notices-panel"
                className="card absolute right-0 top-full z-30 mt-2 w-[min(19rem,calc(100vw-3rem))] shadow-sm"
                aria-labelledby="notices-title"
              >
                <h2 id="notices-title" className="border-b border-line px-4 py-3 font-semibold">Notifications</h2>
                {!allNotices.length && <p className="p-4 text-muted">No notifications for this program.</p>}
                <ul className="max-h-[55vh] divide-y divide-line overflow-y-auto">
                  {allNotices.map(notice => (
                    <li key={notice.id}>
                      {notice.siteId ? (
                        <Link to={sitePath(notice.siteId)} className="btn m-2 justify-start text-left" onClick={closePanel}>
                          {notice.unread && <strong>Unread</strong>}
                          {notice.text}
                        </Link>
                      ) : <p className="p-3">{notice.text}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              ref={accountButton}
              className="btn text-left"
              aria-expanded={['account', 'access', 'switch'].includes(panel)}
              aria-controls={['account', 'access', 'switch'].includes(panel) ? 'account-panel' : undefined}
              onClick={() => setPanel(panel && panel !== 'notices' ? null : 'account')}
            >
              <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-green-wash text-meta font-semibold text-teal-ink">
                {initials(actor.name)}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold leading-tight text-ink">{actor.name}</span>
                <span className="meta block leading-tight">{actor.title}</span>
              </span>
              <Icon name="chevron" />
            </button>
            {['account', 'access', 'switch'].includes(panel) && (
              <section
                id="account-panel"
                aria-label="Account"
                className="card absolute right-0 top-full z-30 mt-2 grid w-[min(19rem,calc(100vw-3rem))] gap-2 p-3 shadow-sm"
              >
                <button
                  type="button"
                  className="btn justify-start"
                  aria-expanded={panel === 'access'}
                  onClick={() => setPanel(panel === 'access' ? 'account' : 'access')}
                >
                  Your access
                </button>
                {panel === 'access' && (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 p-2 text-meta">
                    {Object.entries({
                      Name: actor.name,
                      'Job title': actor.title,
                      Role: actor.role,
                      Email: actor.email,
                      'Employee ID': actor.employeeId,
                      Phone: actor.phone?.replace(/[^0-9]/g, '').slice(-4)
                    }).map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="font-semibold">{label}</dt>
                        <dd className="break-words">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <button type="button" className="btn justify-start" onClick={openGuide}>Scores and approvals</button>
                <button
                  type="button"
                  className="btn justify-start"
                  aria-expanded={panel === 'switch'}
                  onClick={() => setPanel(panel === 'switch' ? 'account' : 'switch')}
                >
                  Switch user
                </button>
                {panel === 'switch' && (
                  <ul className="grid gap-1">
                    {accounts.map(account => (
                      <li key={account.id}>
                        <button
                          type="button"
                          className="btn w-full justify-start"
                          disabled={account.id === actor.id}
                          onClick={() => onSwitch(account.id)}
                        >
                          {account.name} · {account.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {admin && onRestore &&
                  <button
                    type="button"
                    className="btn justify-start"
                    onClick={() => {
                      closePanel();
                      onRestore(accountButton.current);
                    }}
                  >
                    Restore morning snapshot…
                  </button>}
                <button type="button" className="btn justify-start" onClick={onSignOut}>Sign out</button>
              </section>
            )}
          </div>
        </div>
      </header>
      <div className="shell-layout min-h-[65vh] lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="border-b border-line bg-card px-3 py-3 lg:border-b-0 lg:border-r">
          <nav aria-label="Program" className="flex flex-wrap gap-1 lg:flex-col">
            {navigation.filter(([path]) => admin || path !== '/service-health').map(([path, label]) => (
              <Link key={path} to={programPath(path, programId)} className="program-nav-link"
                aria-current={(path === '/' ? isPrograms : path === route) ? 'page' : path === '/board' && isSite ? 'location' : undefined}>
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <main id="main-content" tabIndex={-1} className="min-w-0 px-4 py-4 md:p-6">
          {children}
        </main>
      </div>
      <footer className="program-footer flex flex-wrap justify-between gap-2 px-4 py-4 md:px-6">
        <strong>NRO Readiness</strong>
        <span>{board.program.cluster}</span>
      </footer>
      <dialog
        ref={guide}
        aria-labelledby="guide-title"
        className={'fixed inset-y-0 left-auto right-0 m-0 h-full max-h-none w-full max-w-md overflow-y-auto ' +
          'border-l border-line bg-card p-6 text-body shadow-md backdrop:bg-ink/40'}
        onClick={event => {
          if (event.target === event.currentTarget) {
            const box = event.currentTarget.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) guide.current.close();
          }
        }}
        onClose={() => {
          if (guideOpen.current) accountButton.current?.focus();
          guideOpen.current = false;
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="guide-title" className="program-section-title">Scores and approvals</h2>
          <button className="btn" aria-label="Close guide" autoFocus type="button" onClick={() => guide.current.close()}>
            <Icon name="close" />
          </button>
        </div>
        <dl className="mt-5 space-y-4">
          <div>
            <dt className="font-semibold">Readiness and confidence</dt>
            <dd>
              Readiness is the chance a site is ready on its planned date, scored for a 21-day window.
              Confidence reflects the completeness and freshness of the evidence.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Risk thresholds</dt>
            <dd>
              Good, Needs Attention, and Critical follow the current thresholds. A failed mandatory prerequisite can make a site Critical regardless of its score.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Contributions are not causes</dt>
            <dd>A contribution is an input used by the score, not a cause. Missing or conflicting evidence is not replaced with a guess.</dd>
          </div>
          <div>
            <dt className="font-semibold">Approval is separate from field execution</dt>
            <dd>
              A supplier change, a baseline date change, and a low-confidence dispatch wait for the program manager.
              Approval does not override failed prerequisites or an active hold.
            </dd>
          </div>
        </dl>
      </dialog>
    </>
  );
}

SharedShell.propTypes = {board: PropTypes.object.isRequired, actor: PropTypes.object.isRequired, programId: PropTypes.string.isRequired, query: PropTypes.string.isRequired,
  onQuery: PropTypes.func.isRequired, onSwitch: PropTypes.func.isRequired, onSignOut: PropTypes.func.isRequired,
  onRestore: PropTypes.func, sourceStatus: PropTypes.object.isRequired, children: PropTypes.node.isRequired};
