/** Enter the workspace through the six original demo personas. */
import {useRef, useState} from 'react';
import PropTypes from 'prop-types';
import {Icon} from '../components/icons.jsx';
import {accounts, initials} from '../utils/access.js';

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
    <main className="grid min-h-dvh place-items-start justify-items-center px-4 py-8 sm:py-12">
      <section aria-labelledby="sign-in-title" className="w-full max-w-lg">
        <p className="mb-3 flex items-center gap-2 font-semibold">
          <Icon name="logo" />
          NRO Readiness
        </p>
        <h1 id="sign-in-title">Sign in</h1>
        <p className="mt-2 text-muted">Choose a demo persona below. Real credentials are not required.</p>
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
          <p className="meta">Email and password are optional for demo entry. Use only seeded demo credentials.</p>
        </form>
        <h2 className="mt-4 border-t border-line pt-3 program-section-title">Demo team</h2>
        <ul className="mt-1 divide-y divide-line">
          {accounts.map(account => (
            <li key={account.id} className="flex items-center gap-2 py-1.5">
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-green-wash text-meta font-semibold text-teal-ink">
                {initials(account.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-tight text-ink">{account.name}</p>
                <p className="meta">{account.title} · {account.role}</p>
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
  );
}

LoginPage.propTypes = {onSignIn: PropTypes.func.isRequired, onContinue: PropTypes.func.isRequired};
