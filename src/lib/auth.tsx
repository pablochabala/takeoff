import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured, type Profile } from './supabase';

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  /** True right after the user follows a password-reset email link. */
  recovering: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(supabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const loadAccount = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setIsAdmin(false);
      return;
    }
    const [p, a] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.rpc('is_admin'),
    ]);
    setProfile((p.data as Profile) ?? null);
    setIsAdmin(a.data === true);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadAccount(data.session);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      // Defer DB calls out of the auth callback (supabase-js recommendation).
      setTimeout(() => loadAccount(s), 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadAccount]);

  const value: AuthState = {
    loading,
    session,
    user: session?.user ?? null,
    profile,
    isAdmin,
    recovering,
    refresh: () => loadAccount(session),
    signOut: async () => {
      await supabase.auth.signOut();
      setRecovering(false);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Friendly text for common Supabase auth errors. */
export function authErrorMessage(err: { message?: string } | null | undefined): string {
  const msg = err?.message ?? 'Something went wrong. Please try again.';
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first — check your inbox for the link.';
  if (/user already registered/i.test(msg)) return 'An account with this email already exists. Try logging in.';
  if (/password should be at least/i.test(msg)) return 'Password must be at least 8 characters.';
  if (/failed to fetch|network/i.test(msg)) return 'No internet connection. Please reconnect and try again.';
  return msg;
}
