import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import Logo from '../components/Logo';
import InstallInstructions from '../components/InstallInstructions';
import ConfigBanner from '../components/ConfigBanner';

const Workspace = lazy(() => import('../takeoff/Workspace'));

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="landing">
      <ConfigBanner />
      <header className="landing-nav">
        <Logo />
        <nav>
          {user ? (
            <Link to="/app" className="btn btn-primary">Open app</Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">Log in</Link>
              <Link to="/signup" className="btn btn-primary">Sign up free</Link>
            </>
          )}
        </nav>
      </header>

      <section className="hero">
        <div className="hero-text">
          <h1>
            Measure drawings.
            <br />
            <span className="accent">Price the job.</span>
          </h1>
          <p className="lead">
            TakeoffPro turns construction drawings into quantities and costs — walls, slabs, roofing, doors and windows —
            on your phone, tablet or computer.
          </p>
          <div className="hero-cta">
            <a href="#try" className="btn btn-accent btn-lg">Upload a drawing</a>
            <Link to={user ? '/app' : '/signup'} className="btn btn-ghost btn-lg">
              {user ? 'Go to my projects' : 'Sign up free'}
            </Link>
          </div>
          <p className="muted small">Free to use. Measure right away — no account needed. Sign up (free) to export and sync.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <svg viewBox="0 0 400 280">
            <rect x="0" y="0" width="400" height="280" rx="16" fill="#fff" />
            <g stroke="#1E3A5F" strokeWidth="5" fill="none">
              <rect x="40" y="40" width="320" height="200" />
              <path d="M180 40v200M180 140h180M40 120h140" />
            </g>
            <polygon points="186,146 354,146 354,234 186,234" fill="#F97316" fillOpacity="0.22" stroke="#F97316" strokeWidth="3" />
            <path d="M40 26h320" stroke="#64748B" strokeWidth="2" />
            <path d="M40 20v12M360 20v12" stroke="#64748B" strokeWidth="2" />
            <text x="200" y="18" textAnchor="middle" fontSize="13" fill="#334155" fontFamily="sans-serif">11 950</text>
            <text x="270" y="195" textAnchor="middle" fontSize="15" fill="#9A3412" fontWeight="700" fontFamily="sans-serif">26.0 m²</text>
            {[[70, 70], [130, 70], [70, 180]].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="9" fill="#16A34A" />
            ))}
          </svg>
        </div>
      </section>

      <section id="try" className="try-it">
        <div className="try-head">
          <h2>Try it now — no sign-up</h2>
          <p className="muted">
            Upload a drawing, set the scale and start measuring. Your work is saved on your device, and drawings and
            measurements are shared with TakeoffPro to improve calculation accuracy — see our{' '}
            <Link to="/privacy">Privacy Policy</Link>.
          </p>
        </div>
        <Suspense fallback={<div className="center-screen"><div className="spinner" aria-label="Loading tools" /></div>}>
          <Workspace />
        </Suspense>
      </section>

      <section id="install" className="install-section">
        <h2>Install on your phone or computer</h2>
        <p className="muted">TakeoffPro is an app you install straight from your browser — no app store needed.</p>
        <InstallInstructions />
      </section>

      <footer className="landing-foot">
        <span>© {new Date().getFullYear()} TakeoffPro</span>
        <span>
          <Link to="/terms">Terms of Service</Link> · <Link to="/privacy">Privacy Policy</Link>
        </span>
      </footer>
    </div>
  );
}
