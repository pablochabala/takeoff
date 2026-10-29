import { Link } from 'react-router-dom';

/** Mark: a measuring corner (set-square) with dimension ticks. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#1E3A5F" />
      <path d="M16 14v34h34" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 48 44 20" stroke="#F97316" strokeWidth="6" strokeLinecap="round" />
      <path d="M26 48v-5M36 48v-5M16 38h5M16 28h5" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo">
      <LogoMark />
      <span>
        Takeoff<span className="accent">Pro</span>
      </span>
    </Link>
  );
}
