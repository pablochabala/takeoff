import { supabaseConfigured } from '../lib/supabase';

export default function ConfigBanner() {
  if (supabaseConfigured) return null;
  return (
    <div className="banner warn" role="alert">
      <strong>Supabase not connected.</strong> Copy <code>.env.example</code> to <code>.env.local</code>, add your
      project URL and anon key, then restart <code>npm run dev</code>. See <code>SETUP.md</code>.
    </div>
  );
}
