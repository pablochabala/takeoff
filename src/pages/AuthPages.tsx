import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { authErrorMessage, useAuth } from '../lib/auth';
import { supabase, supabaseConfigured } from '../lib/supabase';
import Logo from '../components/Logo';
import { hasConsent, recordConsent } from '../lib/consent';
import ConfigBanner from '../components/ConfigBanner';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-page">
      <ConfigBanner />
      <div className="auth-card">
        <Logo />
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
      <p className="auth-foot muted">
        <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
      </p>
    </div>
  );
}

function GoogleButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <button
        type="button"
        className="btn btn-google"
        disabled={busy || !supabaseConfigured}
        onClick={async () => {
          setBusy(true);
          setError('');
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${window.location.origin}/app` },
          });
          if (error) {
            setError(authErrorMessage(error));
            setBusy(false);
          }
        }}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.5 17.6 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-3.9 7-9.8 7-17.1z" />
          <path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.9-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.4 0-11.7-4-13.6-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z" />
        </svg>
        {label}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

function Divider() {
  return <div className="divider"><span>or</span></div>;
}

export function Login() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/app';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(authErrorMessage(error));
    else navigate(from, { replace: true });
  }

  return (
    <AuthShell title="Log in" subtitle={<>New here? <Link to="/signup">Create a free account</Link></>}>
      <GoogleButton label="Continue with Google" />
      <Divider />
      <form onSubmit={submit} className="form">
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div className="form-row-end">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !supabaseConfigured}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthShell>
  );
}

export function Signup() {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  if (user) return <Navigate to="/app" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    setError('');
    if (!hasConsent()) await recordConsent();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/app` },
    });
    setBusy(false);
    if (error) return setError(authErrorMessage(error));
    // With email confirmation on, Supabase returns no session until the link is clicked.
    if (!data.session) setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <p>
          We sent a confirmation link to <strong>{email}</strong>. Open it on this device to finish creating your
          account.
        </p>
        <Link to="/login" className="btn btn-secondary btn-block">Back to log in</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle={<>Free to use. Already have an account? <Link to="/login">Log in</Link></>}>
      <GoogleButton label="Sign up with Google" />
      <p className="muted small" style={{ marginTop: '0.5rem' }}>
        By continuing with Google you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>, including data collection to improve accuracy.
      </p>
      <Divider />
      <form onSubmit={submit} className="form">
        <label>
          Full name
          <input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password <span className="muted">(min 8 characters)</span>
          <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
          <span>
            I agree to the <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>, including the
            collection of my drawings, measurements and usage data to improve calculation accuracy
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !agree || !supabaseConfigured}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) setError(authErrorMessage(error));
    else setSent(true);
  }

  return (
    <AuthShell title="Reset password" subtitle="We'll email you a link to choose a new password.">
      {sent ? (
        <>
          <p>If an account exists for <strong>{email}</strong>, a reset link is on its way.</p>
          <Link to="/login" className="btn btn-secondary btn-block">Back to log in</Link>
        </>
      ) : (
        <form onSubmit={submit} className="form">
          <label>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || !supabaseConfigured}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <Link to="/login" className="center-link">Back to log in</Link>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const { loading, session } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(authErrorMessage(error));
    else navigate('/app', { replace: true });
  }

  if (loading) return <div className="center-screen"><div className="spinner" /></div>;
  if (!session) {
    return (
      <AuthShell title="Link expired">
        <p>This reset link is invalid or has expired. Request a new one.</p>
        <Link to="/forgot-password" className="btn btn-primary btn-block">Request new link</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="form">
        <label>
          New password
          <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Confirm new password
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthShell>
  );
}
