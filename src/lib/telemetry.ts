import { get, set } from 'idb-keyval';
import { supabase, supabaseConfigured } from './supabase';

// Usage & accuracy data collection. Only runs after the user has agreed to the
// Privacy Policy (see consent.ts). Events are queued on the device and sent in
// batches, so nothing is lost while offline.

export const APP_VERSION = '0.2.0';

const QUEUE_KEY = 'takeoff:telemetry-queue';
const UPLOAD_QUEUE_KEY = 'takeoff:upload-queue';
const MAX_QUEUE = 2000;

type QueuedEvent = { event: string; props: Record<string, unknown>; client_at: string; session_id: string };
type QueuedUpload = { path: string; blob: Blob; contentType: string };

function randomId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Stable anonymous id for this browser/device (no personal data). */
export function getDeviceId() {
  try {
    let id = localStorage.getItem('takeoff:device');
    if (!id) {
      id = randomId();
      localStorage.setItem('takeoff:device', id);
    }
    return id;
  } catch {
    return 'no-storage-device';
  }
}

const SESSION_ID = randomId();

function consented() {
  try {
    const c = JSON.parse(localStorage.getItem('takeoff:consent') || 'null');
    return !!c?.accepted;
  } catch {
    return false;
  }
}

function readQueue(): QueuedEvent[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}
function writeQueue(q: QueuedEvent[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch {
    /* ignore */
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Record an event (no-op until the user has consented). */
export function track(event: string, props: Record<string, unknown> = {}) {
  if (!consented()) return;
  const q = readQueue();
  q.push({ event, props, client_at: new Date().toISOString(), session_id: SESSION_ID });
  writeQueue(q);
  if (!timer) timer = setTimeout(flushNow, 4000);
}

let flushing = false;
export async function flushNow() {
  timer = null;
  if (!supabaseConfigured || flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const q = readQueue();
    if (q.length) {
      const batch = q.slice(0, 200);
      const { data } = await supabase.auth.getSession();
      const device_id = getDeviceId();
      const { error } = await supabase.from('telemetry_events').insert(
        batch.map((e) => ({ ...e, device_id, user_id: data.session?.user.id ?? null, app_version: APP_VERSION })),
      );
      if (!error) {
        writeQueue(readQueue().slice(batch.length));
        if (q.length > batch.length) timer = setTimeout(flushNow, 500);
      }
    }
    await flushUploads();
  } finally {
    flushing = false;
  }
}

/** Keep a copy of an uploaded drawing for accuracy research (queued if offline). */
export async function collectDrawing(file: Blob, name: string, meta: Record<string, unknown>) {
  if (!consented()) return;
  const safe = name.replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'drawing';
  const path = `${getDeviceId()}/${new Date().toISOString().slice(0, 10)}/${randomId()}-${safe}`;
  track('drawing_collected', { path, name, bytes: file.size, type: file.type, ...meta });
  try {
    const q = (await get<QueuedUpload[]>(UPLOAD_QUEUE_KEY)) ?? [];
    q.push({ path, blob: file, contentType: file.type || 'application/octet-stream' });
    await set(UPLOAD_QUEUE_KEY, q.slice(-20));
  } catch {
    /* storage unavailable */
  }
  flushNow();
}

async function flushUploads() {
  let q: QueuedUpload[];
  try {
    q = (await get<QueuedUpload[]>(UPLOAD_QUEUE_KEY)) ?? [];
  } catch {
    return;
  }
  while (q.length && navigator.onLine) {
    const u = q[0];
    const { error } = await supabase.storage.from('training-uploads').upload(u.path, u.blob, { contentType: u.contentType, upsert: false });
    // "already exists" counts as done; any other error → retry later.
    if (error && !/exists/i.test(error.message)) break;
    q = q.slice(1);
    await set(UPLOAD_QUEUE_KEY, q);
  }
}

/** One event per app load with basic, non-identifying device info. */
export function trackSessionStart() {
  track('session_start', {
    path: location.pathname,
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    ua: navigator.userAgent.slice(0, 300),
    lang: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    touch: navigator.maxTouchPoints > 0,
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
}
