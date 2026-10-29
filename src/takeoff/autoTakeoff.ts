import { supabase, supabaseConfigured } from '../lib/supabase';
import {
  categoryColor,
  uid,
  type AutoQuery,
  type AutoState,
  type AutoView,
  type MeasureType,
  type Measurement,
  type SheetMeta,
  type TakeoffDoc,
} from './types';

// Client side of Auto takeoff (two steps — see supabase/functions/auto-takeoff/prompt.ts):
//   1. views:   find plan / elevation / section / schedule views on each sheet
//   2. takeoff: ordered takeoff from those views, with queries for anything estimated

export type ViewsResult = {
  project: string;
  views: Array<{ sheet_index: number; kind: AutoView['kind']; name: string; scale_label: string; bbox: number[]; provides: string }>;
  facts: string[];
};

export type AutoItem = {
  step: number;
  element: string;
  section: string;
  name: string;
  description: string;
  unit: 'm' | 'm2' | 'm3' | 'No' | 'Item';
  timesing: number;
  dims: number[];
  deduct: boolean;
  working: string;
  ref: string;
  confidence: 'high' | 'medium' | 'low';
  query_ids: string[];
  sheet_index: number;
};

export type TakeoffResult = {
  summary: string;
  key_figures: Array<{ label: string; value: number; unit: string; working: string; ref: string; query_ids: string[] }>;
  items: AutoItem[];
  queries: Array<Omit<AutoQuery, 'answer'>>;
};

export type SheetPayload = { index: number; name: string; overview: string; tiles: Array<{ data: string; label: string }>; text: string };

const OVERVIEW_PX = 1568; // long edge the model sees without downscaling
const TILE_PX = 1500;
const OVERLAP = 120;

async function toJpegBase64(canvas: HTMLCanvasElement, quality = 0.82) {
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', quality));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

function crop(img: ImageBitmap, x: number, y: number, w: number, h: number, scale = 1) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

/** Overview + overlapping full-resolution tiles so small dimension figures stay readable. */
async function prepareSheet(sheet: SheetMeta, blob: Blob, index: number): Promise<SheetPayload> {
  const img = await createImageBitmap(blob);
  const W = img.width;
  const H = img.height;
  const s = Math.min(1, OVERVIEW_PX / Math.max(W, H));
  const overview = await toJpegBase64(crop(img, 0, 0, W, H, s));
  const cols = Math.max(1, Math.ceil((W - OVERLAP) / (TILE_PX - OVERLAP)));
  const rows = Math.max(1, Math.ceil((H - OVERLAP) / (TILE_PX - OVERLAP)));
  const tiles: Array<{ data: string; label: string }> = [];
  if (cols * rows > 1) {
    const tw = Math.ceil((W + OVERLAP * (cols - 1)) / cols);
    const th = Math.ceil((H + OVERLAP * (rows - 1)) / rows);
    const vName = (r: number) => (rows === 1 ? '' : r === 0 ? 'top' : r === rows - 1 ? 'bottom' : 'middle');
    const hName = (c: number) => (cols === 1 ? '' : c === 0 ? 'left' : c === cols - 1 ? 'right' : cols === 3 ? 'centre' : `column ${c + 1}`);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = Math.min(W - tw, c * (tw - OVERLAP));
        const y = Math.min(H - th, r * (th - OVERLAP));
        tiles.push({
          data: await toJpegBase64(crop(img, x, y, tw, th)),
          label: `${[vName(r), hName(c)].filter(Boolean).join('-')} (page fraction x ${(x / W).toFixed(2)}–${((x + tw) / W).toFixed(2)}, y ${(y / H).toFixed(2)}–${((y + th) / H).toFixed(2)})`,
        });
      }
    }
  }
  img.close();
  const text = (sheet.text ?? [])
    .slice(0, 2500)
    .map((t) => `${(t.x / W).toFixed(3)},${(t.y / H).toFixed(3)},${t.a},${t.s}`)
    .join('\n');
  return { index, name: sheet.name, overview, tiles, text };
}

export async function prepareSheets(doc: TakeoffDoc, blobs: Map<string, Blob>, sheetIds: string[], onStatus: (msg: string) => void) {
  const out: SheetPayload[] = [];
  for (const [i, id] of sheetIds.entries()) {
    const sheet = doc.sheets.find((s) => s.id === id);
    const blob = blobs.get(id);
    if (!sheet || !blob) continue;
    onStatus(`Preparing sheet ${i + 1} of ${sheetIds.length}…`);
    out.push(await prepareSheet(sheet, blob, i + 1));
  }
  return out;
}

async function call<T>(body: Record<string, unknown>, onStatus: (msg: string) => void): Promise<T> {
  if (!supabaseConfigured) throw new Error('Cloud is not set up yet — run the SQL files and deploy the auto-takeoff function (SETUP.md, section 4c).');
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Please log in to use Auto takeoff.');
  if (!navigator.onLine) throw new Error('Auto takeoff needs an internet connection.');

  let res: Response;
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-takeoff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the Auto takeoff service. Check your connection, and that the auto-takeoff function is deployed (SETUP.md, section 4c).');
  }
  if (!res.ok || !res.body) {
    let msg = `Auto takeoff failed (${res.status}).`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* not JSON */
    }
    if (res.status === 404) msg = 'Auto takeoff is not deployed yet. Deploy the auto-takeoff function and set the ANTHROPIC_API_KEY secret (SETUP.md, section 4c).';
    throw new Error(msg);
  }

  // NDJSON stream: {status} … {result} | {error}
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.status) onStatus(msg.status);
      if (msg.error) throw new Error(msg.error);
      if (msg.result) return msg.result as T;
    }
    if (done) break;
  }
  throw new Error('The connection closed before the AI finished (the server time limit may have been reached). Try fewer sheets at once.');
}

/** Step 1: find the plan / elevation / section views on each sheet. */
export function readViews(sheets: SheetPayload[], projectName: string, onStatus: (msg: string) => void) {
  return call<ViewsResult>({ mode: 'views', sheets, projectName }, onStatus);
}

/** Step 2: ordered takeoff using the identified views (and any answered queries). */
export function readTakeoff(
  sheets: SheetPayload[],
  views: ViewsResult['views'],
  categories: string[],
  projectName: string,
  answers: Array<{ id: string; question: string; answer: string }>,
  onStatus: (msg: string) => void,
) {
  return call<TakeoffResult>({ mode: 'takeoff', sheets, views, categories, projectName, answers }, onStatus);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

export function toViews(v: ViewsResult, sheetIds: string[]): AutoView[] {
  return v.views
    .filter((x) => sheetIds[x.sheet_index - 1])
    .map((x) => {
      const [a = 0, b = 0, c = 1, d = 1] = x.bbox ?? [];
      return {
        sheetId: sheetIds[x.sheet_index - 1],
        kind: x.kind,
        name: x.name,
        scaleLabel: x.scale_label,
        bbox: [clamp01(Math.min(a, c)), clamp01(Math.min(b, d)), clamp01(Math.max(a, c)), clamp01(Math.max(b, d))],
        provides: x.provides,
      };
    });
}

const TYPE_OF: Record<AutoItem['unit'], MeasureType> = { m: 'linear', m2: 'area', m3: 'volume', No: 'count', Item: 'count' };
const DEFAULT_WASTE: Record<MeasureType, number> = { linear: 5, area: 5, volume: 5, count: 0 };

/** Convert the AI answer into measurements + the auto state (key figures, queries) for the doc. */
export function applyTakeoff(
  t: TakeoffResult,
  views: AutoView[],
  facts: string[],
  doc: TakeoffDoc,
  sheetIds: string[],
  previousAnswers: AutoQuery[],
): { measurements: Measurement[]; categories: string[]; auto: AutoState } {
  const categories = [...doc.categories];
  // Answered questions stay visible (marked answered); new queries are numbered after them so ids never clash.
  const answered = previousAnswers.filter((q) => q.answer?.trim());
  let next = answered.reduce((m, q) => Math.max(m, Number(q.id.replace(/D/g, '')) || 0), 0);
  const idMap = new Map<string, string>();
  for (const q of t.queries) idMap.set(q.id, `Q${++next}`);
  const mapIds = (ids: string[] | undefined) => (ids ?? []).map((i) => idMap.get(i) ?? i);
  const measurements = [...t.items]
    .filter((it) => it.dims?.length && it.dims.every((d) => Number.isFinite(d) && d >= 0))
    .sort((a, b) => a.step - b.step)
    .map((it): Measurement => {
      if (!categories.includes(it.section)) categories.push(it.section);
      const type = TYPE_OF[it.unit] ?? 'count';
      return {
        id: uid(),
        sheetId: sheetIds[it.sheet_index - 1] ?? sheetIds[0],
        type,
        name: it.name,
        description: it.description,
        category: it.section,
        color: categoryColor(it.section, categories),
        timesing: it.timesing || 1,
        wastePct: it.unit === 'Item' ? 0 : DEFAULT_WASTE[type],
        rateUsd: 0,
        depthM: null,
        points: [],
        holes: [],
        source: 'auto',
        dims: it.dims,
        deduct: it.deduct,
        unit: it.unit === 'Item' ? 'Item' : undefined,
        working: it.working,
        confidence: it.confidence,
        ref: it.ref,
        element: it.element,
        step: it.step,
        queryIds: it.query_ids?.length ? mapIds(it.query_ids) : undefined,
      };
    });
  const auto: AutoState = {
    views,
    facts,
    keyFigures: t.key_figures.map((k) => ({ label: k.label, value: k.value, unit: k.unit, working: k.working, ref: k.ref, queryIds: mapIds(k.query_ids) })),
    queries: [...answered, ...t.queries.map((q) => ({ ...q, id: idMap.get(q.id)! }))],
    summary: t.summary,
    sheetIds,
    runAt: new Date().toISOString(),
  };
  return { measurements, categories, auto };
}
