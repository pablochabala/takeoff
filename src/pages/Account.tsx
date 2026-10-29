import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, type Profile } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { readConsent } from '../lib/consent';

export default function Account() {
  const { user, profile, refresh, signOut } = useAuth();
  const consent = readConsent();
  const [form, setForm] = useState<Partial<Profile>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setMsg('');
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: form.full_name ?? null,
        company: form.company ?? null,
        unit_system: form.unit_system,
        currency: form.currency,
        zmw_per_usd: Number(form.zmw_per_usd),
      })
      .eq('id', user.id);
    setBusy(false);
    setMsg(error ? `Could not save: ${error.message}` : 'Saved.');
    if (!error) refresh();
  }


  return (
    <div className="page narrow">
      <h1>Account settings</h1>

      <form className="card form" onSubmit={save}>
        <h3>Profile & preferences</h3>
        <label>
          Email
          <input value={user?.email ?? ''} disabled />
        </label>
        <label>
          Full name
          <input value={form.full_name ?? ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </label>
        <label>
          Company
          <input value={form.company ?? ''} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        </label>
        <div className="grid-2">
          <label>
            Units
            <select value={form.unit_system ?? 'metric'} onChange={(e) => setForm({ ...form, unit_system: e.target.value as Profile['unit_system'] })}>
              <option value="metric">Metric (m, m², m³)</option>
              <option value="imperial">Imperial (ft, ft², yd³)</option>
            </select>
          </label>
          <label>
            Currency
            <select value={form.currency ?? 'USD'} onChange={(e) => setForm({ ...form, currency: e.target.value as Profile['currency'] })}>
              <option value="USD">USD ($)</option>
              <option value="ZMW">ZMW (K)</option>
            </select>
          </label>
        </div>
        <label>
          Exchange rate — ZMW per 1 USD
          <input type="number" min="0.0001" step="0.0001" value={form.zmw_per_usd ?? ''} onChange={(e) => setForm({ ...form, zmw_per_usd: Number(e.target.value) })} />
        </label>
        {msg && <p className={msg === 'Saved.' ? 'ok-text' : 'form-error'}>{msg}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </form>

      <div className="card">
        <h3>Your data & privacy</h3>
        <p className="muted small">
          TakeoffPro collects the drawings you upload and the measurements you make to improve calculation accuracy.
          Read the <Link to="/privacy">Privacy Policy</Link> for details.
        </p>
        <dl className="kv">
          <dt>Consent given</dt>
          <dd>{consent ? new Date(consent.at).toLocaleString() : 'Not yet'}</dd>
          <dt>Policy version</dt>
          <dd>{consent?.version ?? '—'}</dd>
        </dl>
        <p className="muted small">
          To get a copy of your data, correct it, or have it deleted, email [CONTACT EMAIL]. We respond within 30 days.
        </p>
      </div>

      <button className="btn btn-ghost danger" onClick={signOut}>Log out</button>
    </div>
  );
}
