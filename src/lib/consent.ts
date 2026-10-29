import { track, getDeviceId, flushNow } from './telemetry';
import { supabase, supabaseConfigured } from './supabase';

/** Bump when the Privacy Policy changes materially — users are asked to agree again. */
export const POLICY_VERSION = '2026-10-27';

/** The exact sentence users tick. Stored with every consent record as proof. */
export const CONSENT_TEXT =
  'I have read and agree to the Terms of Service and Privacy Policy. I understand that TakeoffPro collects the ' +
  'drawings I upload, the scales and measurements I make, my corrections, and basic device and usage information, ' +
  'and uses them to provide the service and to improve the accuracy of its calculations. When I use Auto takeoff, ' +
  'my drawings are sent to TakeoffPro’s AI provider (Anthropic) to be read.';

export type ConsentRecord = { version: string; at: string; accepted: boolean };

const KEY = 'takeoff:consent';

export function readConsent(): ConsentRecord | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null') as ConsentRecord | null;
    return c && c.version === POLICY_VERSION && c.accepted ? c : null;
  } catch {
    return null;
  }
}

export function hasConsent() {
  return !!readConsent();
}

export async function recordConsent(): Promise<ConsentRecord> {
  const rec: ConsentRecord = { version: POLICY_VERSION, at: new Date().toISOString(), accepted: true };
  try {
    localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* private mode — consent still logged on the server below */
  }
  if (supabaseConfigured) {
    const { data } = await supabase.auth.getSession();
    const { error } = await supabase.from('consent_log').insert({
      device_id: getDeviceId(),
      user_id: data.session?.user.id ?? null,
      policy_version: POLICY_VERSION,
      consent_text: CONSENT_TEXT,
      accepted: true,
      user_agent: navigator.userAgent.slice(0, 500),
      locale: navigator.language?.slice(0, 20),
    });
    // Offline: keep a copy in the event queue so proof still reaches the server later.
    if (error) track('consent_given_offline', { version: POLICY_VERSION, text: CONSENT_TEXT, at: rec.at });
  }
  track('consent_given', { version: POLICY_VERSION });
  flushNow();
  return rec;
}
