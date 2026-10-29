import type { Measurement, Pt, Scale, SheetMeta, UnitSystem, Currency } from './types';

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function polylineLength(pts: Pt[]) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

export function polygonArea(pts: Pt[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function centroid(pts: Pt[]): Pt {
  const n = pts.length || 1;
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
}

/** Scale of the region containing `p` (newest region wins), else the sheet scale. */
export function scaleAt(sheet: SheetMeta, p: Pt | undefined): Scale | null {
  if (p) {
    for (let i = sheet.regions.length - 1; i >= 0; i--) {
      const r = sheet.regions[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r.scale;
    }
  }
  return sheet.scale;
}

/** Preset ratio (e.g. 50 for 1:50) → metres per pixel, given pixels per paper-mm. */
export function presetScale(ratio: number, pxPerPaperMm: number): Scale {
  return { mPerPx: ratio / pxPerPaperMm / 1000, label: `1:${ratio}` };
}

export const METRIC_PRESETS = [20, 50, 75, 100, 200, 500];
/** Imperial architectural scales expressed as ratios. */
export const IMPERIAL_PRESETS: Array<{ label: string; ratio: number }> = [
  { label: '1" = 1\'', ratio: 12 },
  { label: '1/2" = 1\'', ratio: 24 },
  { label: '1/4" = 1\'', ratio: 48 },
  { label: '1/8" = 1\'', ratio: 96 },
  { label: '1/16" = 1\'', ratio: 192 },
  { label: '1" = 40\'', ratio: 480 },
];

/** Raw metric quantity (before timesing / waste): m, m², m³ or count. Null if no scale. */
export function rawQuantity(m: Measurement, sheet: SheetMeta): number | null {
  // Auto-takeoff items carry their dimension-paper figures instead of a drawn shape.
  if (m.dims?.length) return m.dims.reduce((p, d) => p * d, 1);
  if (m.type === 'count') return m.points.length;
  const s = scaleAt(sheet, m.points[0]);
  if (!s) return null;
  if (m.type === 'linear') return polylineLength(m.points) * s.mPerPx;
  const area = Math.max(0, polygonArea(m.points) - m.holes.reduce((t, h) => t + polygonArea(h), 0)) * s.mPerPx ** 2;
  if (m.type === 'area') return area;
  return area * (m.depthM ?? 0);
}

/** Quantity after timesing; negative for SMM deductions ("Ddt"). */
export function netQuantity(m: Measurement, sheet: SheetMeta) {
  const q = rawQuantity(m, sheet);
  return q == null ? null : q * (m.timesing || 1) * (m.deduct ? -1 : 1);
}

/** Display unit for a measurement, honouring lump-sum "Item" lines. */
export function unitFor(m: Measurement, sys: UnitSystem) {
  return m.unit === 'Item' ? 'Item' : unitLabel(m.type, sys);
}

// ── Units ────────────────────────────────────────────
const FT = 3.28084;
const FT2 = FT * FT;
const YD3 = 1.30795;

export function unitLabel(type: Measurement['type'], sys: UnitSystem) {
  if (type === 'count') return 'No.';
  if (sys === 'metric') return type === 'linear' ? 'm' : type === 'area' ? 'm²' : 'm³';
  return type === 'linear' ? 'ft' : type === 'area' ? 'ft²' : 'yd³';
}

/** Convert a metric quantity to the display unit system. */
export function toDisplay(q: number, type: Measurement['type'], sys: UnitSystem) {
  if (sys === 'metric' || type === 'count') return q;
  return type === 'linear' ? q * FT : type === 'area' ? q * FT2 : q * YD3;
}

/** Convert a length in metres for display. */
export const lenDisplay = (m: number, sys: UnitSystem) => (sys === 'metric' ? m : m * FT);

/** Rates are stored per metric unit; convert to per display unit. */
export function rateToDisplayUnit(ratePerMetric: number, type: Measurement['type'], sys: UnitSystem) {
  if (sys === 'metric' || type === 'count') return ratePerMetric;
  return type === 'linear' ? ratePerMetric / FT : type === 'area' ? ratePerMetric / FT2 : ratePerMetric / YD3;
}
export function rateFromDisplayUnit(rate: number, type: Measurement['type'], sys: UnitSystem) {
  if (sys === 'metric' || type === 'count') return rate;
  return type === 'linear' ? rate * FT : type === 'area' ? rate * FT2 : rate * YD3;
}

export const fmt = (n: number, d = 2) =>
  n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

export function money(usd: number, cur: Currency, zmwPerUsd: number) {
  const v = cur === 'USD' ? usd : usd * zmwPerUsd;
  return `${cur === 'USD' ? '$' : 'K'}${fmt(v)}`;
}

/** Is this 4-point polygon (roughly) a rectangle? Returns its side lengths in px. */
export function rectSides(pts: Pt[]): [number, number] | null {
  if (pts.length !== 4) return null;
  const d = [dist(pts[0], pts[1]), dist(pts[1], pts[2]), dist(pts[2], pts[3]), dist(pts[3], pts[0])];
  const diag1 = dist(pts[0], pts[2]);
  const diag2 = dist(pts[1], pts[3]);
  const ok = Math.abs(d[0] - d[2]) / Math.max(d[0], d[2]) < 0.03 && Math.abs(d[1] - d[3]) / Math.max(d[1], d[3]) < 0.03 && Math.abs(diag1 - diag2) / Math.max(diag1, diag2) < 0.03;
  return ok ? [(d[0] + d[2]) / 2, (d[1] + d[3]) / 2] : null;
}
