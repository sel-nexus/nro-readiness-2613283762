/** Show credential entry and the West Metro team's six account handoffs. */
import {useRef, useState} from 'react';
import PropTypes from 'prop-types';
import {Icon} from '../components/icons.jsx';
import {accounts, initials} from '../utils/access.js';
import {RISK_STYLE} from '../utils/portfolio.js';

const preview = [['Harbor Point', 'Red'], ['Civic Center', 'Green'], ['Lakeside', 'Amber']];

/** Render both entry paths and clear passwords on completion. */
export default function LoginPage({onSignIn, onContinue}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(false);

  /** Prevent concurrent entry attempts and show only the redacted result. */
  async function enter(action) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) setError(result.error);
    } catch {
      setError({code: 'ACCESS_UNAVAILABLE', message: 'Could not sign in. Try again.'});
    } finally {
      setPassword('');
      setShow(false);
      setBusy(false);
      pending.current = false;
    }
  }

  const invalid = error?.code === 'BAD_LOGIN';
  return (
    <div className="login-grid min-h-screen bg-surface">
      <section aria-label="Network Rollout Operations" className="flex min-h-24 flex-col justify-center bg-ink px-6 py-4 text-white md:px-10 min-[1366px]:p-16">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <span className="grid size-8 place-items-center rounded-control border border-white/25 text-white">
            <Icon name="logo" />
          </span>
          NRO Readiness
        </div>
        <p className="mt-2 hidden text-white/75 md:block">Network Rollout Operations</p>
        <p className="mt-2 max-w-md font-semibold tracking-tight md:text-title min-[1366px]:mt-12 min-[1366px]:text-5xl">
          Stop the crew before a failed visit.
        </p>
        <ul className="mt-6 hidden space-y-2 border-l border-white/25 pl-4 text-white/80 min-[1366px]:block">
          <li>16 sites on the West Metro board</li>
          <li>2 crews on hold for power</li>
          <li>Approvals stay with the program manager</li>
        </ul>
        <ul className="mt-10 hidden max-w-sm divide-y divide-white/15 rounded-card border border-white/20 min-[1366px]:block">
          {preview.map(([name, risk]) => (
            <li key={name} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>{name}</span>
              <span className={`badge ${RISK_STYLE[risk].badge}`}>
                <Icon name={risk} />
                {risk}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <main className="grid min-w-0 place-items-center px-4 py-5 md:px-8">
        <section aria-labelledby="sign-in-title" className="w-full max-w-[440px] rounded-xl border border-line bg-card px-5 py-5 shadow-sm md:px-7">
          <h1 id="sign-in-title" className="text-title font-semibold text-ink">Sign in</h1>
          <p className="meta mt-1">West Metro Cluster 4</p>
          <form className="mt-4 space-y-2" noValidate onSubmit={event => { event.preventDefault(); void enter(() => onSignIn({email, password})); }}>
            <label className="block font-medium" htmlFor="login-email">Email</label>
            <input id="login-email" className="field w-full" type="email" autoComplete="username" required
              aria-invalid={invalid} aria-describedby={invalid ? 'login-error' : undefined}
              value={email} onChange={event => setEmail(event.target.value)} />
            <label className="block font-medium" htmlFor="login-password">Password</label>
            <div className="flex gap-2">
              <input id="login-password" className="field min-w-0 flex-1" type={show ? 'text' : 'password'} autoComplete="current-password" required
                aria-invalid={invalid} aria-describedby={invalid ? 'login-error' : undefined}
                value={password} onChange={event => setPassword(event.target.value)} />
              <button type="button" className="btn" aria-controls="login-password" onClick={() => setShow(value => !value)}>
                {show ? 'Hide password' : 'Show password'}
              </button>
            </div>
            <p id="login-error" role="alert" className="min-h-[18px] text-meta text-red">{error?.message}</p>
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <p className="meta">Password help goes to the cluster administrator.</p>
          </form>
          <h2 className="mt-4 border-t border-line pt-3 text-meta font-semibold text-muted">West Metro team</h2>
          <ul className="mt-1 divide-y divide-line">
            {accounts.map(account => (
              <li key={account.id} className="flex items-center gap-2 py-1.5">
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-green-wash text-meta font-semibold text-teal-ink">
                  {initials(account.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight text-ink">{account.name}</p>
                  <p className="meta">{account.title}</p>
                </div>
                <button type="button" className="btn" aria-label={`Continue as ${account.name}`} disabled={busy}
                  onClick={() => void enter(() => onContinue(account.id))}>
                  Continue
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

LoginPage.propTypes = {onSignIn: PropTypes.func.isRequired, onContinue: PropTypes.func.isRequired};
