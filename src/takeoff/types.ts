export type Pt = { x: number; y: number };

/** Real-world metres represented by one image pixel. */
export type Scale = { mPerPx: number; label: string };

/** A box on the sheet with its own scale (e.g. a 1:100 elevation on a 1:50 sheet). */
export type ScaleRegion = { id: string; x: number; y: number; w: number; h: number; scale: Scale };

/** A piece of text read from a PDF page, in sheet pixel coordinates (centre point). Angle in degrees. */
export type TextItem = { s: string; x: number; y: number; w: number; h: number; a: number };

export type SheetMeta = {
  id: string;
  name: string;
  source: 'pdf' | 'png' | 'jpg' | 'camera';
  width: number;
  height: number;
  /** Known for PDFs (from page size); lets preset scales like 1:50 work without calibrating. */
  pxPerPaperMm: number | null;
  scale: Scale | null;
  regions: ScaleRegion[];
  /** Text found on the page (PDFs only) — dimensions, labels, scale notes. */
  text?: TextItem[];
  /** How the current sheet scale was obtained. */
  scaleSource?: 'auto' | 'preset' | 'calibrated';
};

export type MeasureType = 'linear' | 'area' | 'count' | 'volume';

export type Measurement = {
  id: string;
  sheetId: string;
  type: MeasureType;
  name: string;
  description: string;
  category: string;
  color: string;
  /** SMM timesing multiplier ("2/"). */
  timesing: number;
  wastePct: number;
  /** Unit rate stored in USD per metric unit (m, m², m³, No.). */
  rateUsd: number;
  depthM: number | null;
  points: Pt[];
  holes: Pt[][];
  /** 'auto' = produced by Auto takeoff from the dimensions on the drawing (no shape drawn). */
  source?: 'drawn' | 'auto';
  /** Dimension-paper figures in metres (or counts); quantity = timesing × product of dims. */
  dims?: number[];
  /** SMM "Ddt" — this item is deducted. */
  deduct?: boolean;
  /** Display unit override for lump-sum items ("Item"). */
  unit?: 'Item';
  /** How the figures were derived (e.g. mean girth working). */
  working?: string;
  confidence?: 'high' | 'medium' | 'low';
  /** Where on the drawings the figures came from. */
  ref?: string;
  /** Taking-off heading (Substructure, Walls, …) and position in the taking-off order. */
  element?: string;
  step?: number;
  /** Engineer queries (Q1, Q2…) whose assumed answers this item depends on. */
  queryIds?: string[];
};

/** A view found on a sheet by Auto takeoff; bbox is [x0, y0, x1, y1] as fractions of the page. */
export type AutoView = {
  sheetId: string;
  kind: 'plan' | 'elevation' | 'section' | 'schedule' | 'detail' | 'notes' | 'title_block';
  name: string;
  scaleLabel: string;
  bbox: [number, number, number, number];
  provides: string;
};

export type KeyFigure = { label: string; value: number; unit: string; working: string; ref: string; queryIds: string[] };

/** Something the AI had to estimate; the engineer answers it and re-runs. */
export type AutoQuery = { id: string; question: string; why: string; ref: string; assumed: string; affects: string; answer?: string };

export type AutoState = {
  views: AutoView[];
  facts: string[];
  keyFigures: KeyFigure[];
  queries: AutoQuery[];
  summary: string;
  sheetIds: string[];
  runAt: string;
};

export type TakeoffDoc = {
  sheets: SheetMeta[];
  measurements: Measurement[];
  categories: string[];
  /** Latest Auto takeoff: views found, key figures (waste calculations) and engineer queries. */
  auto?: AutoState;
};

export type UnitSystem = 'metric' | 'imperial';
export type Currency = 'USD' | 'ZMW';

export const DEFAULT_CATEGORIES = [
  'Substructure',
  'Concrete',
  'Masonry',
  'Roofing',
  'Metalwork / Doors & Windows',
  'Carpentry',
  'Finishes',
  'Plumbing',
  'Electrical',
  'External Works',
  'Other',
];

const PALETTE = ['#F97316', '#2563EB', '#16A34A', '#DC2626', '#9333EA', '#0891B2', '#CA8A04', '#DB2777', '#4B5563', '#65A30D', '#7C3AED'];
export function categoryColor(cat: string, cats: string[]) {
  const i = cats.indexOf(cat);
  return PALETTE[(i < 0 ? cats.length : i) % PALETTE.length];
}

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
