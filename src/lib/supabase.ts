import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured =
  !!url && !!anonKey && !url.includes('YOUR-PROJECT-REF') && !anonKey.includes('YOUR-ANON');

// When not configured we still create a client against a dummy URL so imports
// don't crash; the UI shows a setup banner and disables auth actions.
export const supabase: SupabaseClient = createClient(
  supabaseConfigured ? url! : 'https://placeholder.supabase.co',
  supabaseConfigured ? anonKey! : 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  },
);

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  company: string | null;
  unit_system: 'metric' | 'imperial';
  currency: 'USD' | 'ZMW';
  zmw_per_usd: number;
};

