import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import Logo from './Logo';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export default function AppLayout() {
  const { profile, user, isAdmin } = useAuth();
  const online = useOnline();
  const name = profile?.full_name || user?.email || '';

  return (
    <div className="app-shell">
      <header className="app-bar">
        <Logo to="/app" />
        <nav className="app-nav">
          <NavLink to="/app" end>Projects</NavLink>
          <NavLink to="/app/account">Account</NavLink>
          {isAdmin && <span className="pill">Admin</span>}
        </nav>
        <div className="app-bar-right">
          <span className={online ? 'net on' : 'net off'} title={online ? 'Online' : 'Offline'}>
            {online ? '● Online' : '● Offline'}
          </span>
          <span className="who" title={user?.email}>{name}</span>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
