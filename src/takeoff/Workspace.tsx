import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  centroid,
  dist,
  fmt,
  IMPERIAL_PRESETS,
  lenDisplay,
  METRIC_PRESETS,
  polygonArea,
  presetScale,
  rawQuantity,
  scaleAt,
  toDisplay,
  unitLabel,
} from './geometry';
import { loadFiles } from './loadDrawing';
import { collectDrawing, track, trackSessionStart } from '../lib/telemetry';
import { hasConsent } from '../lib/consent';
import ConsentDialog from '../components/ConsentDialog';
import AutoDialog, { VIEW_LABEL } from './AutoDialog';
import { guestStore, type WorkspaceStore } from './store';
import Panel, { type PanelTab } from './Panel';
import './workspace.css';
import {
  categoryColor,
  DEFAULT_CATEGORIES,
  uid,
  type Currency,
  type Measurement,
  type MeasureType,
  type Pt,
  type Scale,
  type SheetMeta,
  type TakeoffDoc,
  type UnitSystem,
} from './types';

type Tool = 'pan' | 'scale' | 'region' | 'linear' | 'area' | 'cutout' | 'count' | 'volume';
type View = { zoom: number; tx: number; ty: number };
type Dialog =
  | { kind: 'scale'; pts: [Pt, Pt] | null }
  | { kind: 'depth'; points: Pt[] }
  | { kind: 'export' }
  | { kind: 'consent'; files: File[]; camera: boolean; then?: 'auto' }
  | { kind: 'auto'; rerun?: boolean }
  | null;

const EMPTY_DOC: TakeoffDoc = { sheets: [], measurements: [], categories: DEFAULT_CATEGORIES };
const DEFAULT_WASTE: Record<MeasureType, number> = { linear: 5, area: 5, volume: 5, count: 0 };
const TYPE_LABEL: Record<MeasureType, string> = { linear: 'Linear', area: 'Area', volume: 'Volume', count: 'Count' };

const HINTS: Record<Tool, string> = {
  pan: 'Drag to move, scroll or pinch to zoom. Tap a measurement to select it.',
  scale: 'Tap both ends of a dimension you know (e.g. the 11 950 overall), then enter its length.',
  region: 'Drag a box around one view (e.g. an elevation) to give it its own scale.',
  linear: 'Tap points along the wall/pipe. Double-tap, press Enter or tap Finish to end.',
  area: 'Tap the corners. Tap the first point, press Enter or tap Finish to close.',
  cutout: 'Select an area first, then tap the corners of the opening to deduct.',
  count: 'Tap each item (door, window, socket). Tap Finish when done.',
  volume: 'Tap the corners of the area, finish, then enter the depth/thickness.',
};

function loadPrefs(): { units: UnitSystem; currency: Currency; zmwPerUsd: number } {
  try {
    const p = JSON.parse(localStorage.getItem('takeoff:prefs') || '{}');
    return { units: p.units ?? 'metric', currency: p.currency ?? 'USD', zmwPerUsd: p.zmwPerUsd ?? 26 };
  } catch {
    return { units: 'metric', currency: 'USD', zmwPerUsd: 26 };
  }
}

/**
 * The measuring workspace. Mount with a `key` per project so it reloads when the store changes.
 * `status` replaces the default "Saved on this device" text (e.g. a cloud sync badge).
 */
export default function Workspace({ store = guestStore, status, projectName = '' }: { store?: WorkspaceStore; status?: ReactNode; projectName?: string }) {
  const { user, profile } = useAuth();
  const [doc, setDoc] = useState<TakeoffDoc>(EMPTY_DOC);
  const [past, setPast] = useState<TakeoffDoc[]>([]);
  const [future, setFuture] = useState<TakeoffDoc[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('pan');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, tx: 0, ty: 0 });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [regionScale, setRegionScale] = useState<Scale | null>(null);
  /** True while the user is setting a scale for one view (region) rather than the whole sheet. */
  const [pendingRegion, setPendingRegion] = useState(false);
  const [regionDrag, setRegionDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const [category, setCategory] = useState('Masonry');
  const [panelTab, setPanelTab] = useState<PanelTab>('items');
  const [showViews, setShowViews] = useState(true);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; start: { x: number; y: number }; view: View; pinch?: { d: number; mid: { x: number; y: number } } } | null>(null);

  const sheet = doc.sheets.find((s) => s.id === activeId) ?? null;
  const sheetMeasurements = useMemo(() => doc.measurements.filter((m) => m.sheetId === activeId), [doc.measurements, activeId]);
  const selected = doc.measurements.find((m) => m.id === selectedId) ?? null;

  // Profile preferences win once the user is logged in.
  useEffect(() => {
    if (profile) setPrefs({ units: profile.unit_system, currency: profile.currency, zmwPerUsd: Number(profile.zmw_per_usd) });
  }, [profile]);
  useEffect(() => {
    try {
      localStorage.setItem('takeoff:prefs', JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  // Restore previous guest work from this device.
  useEffect(() => {
    store.load().then((g) => {
      if (g) {
        setDoc(g.doc);
        setUrls(new Map([...g.blobs].map(([id, b]) => [id, URL.createObjectURL(b)])));
        setActiveId(g.doc.sheets[0]?.id ?? null);
      }
      setRestored(true);
    });
  }, []);
  useEffect(() => {
    if (restored) store.saveDoc(doc);
  }, [doc, restored]);

  const commit = useCallback((next: TakeoffDoc | ((d: TakeoffDoc) => TakeoffDoc)) => {
    setDoc((d) => {
      const n = typeof next === 'function' ? next(d) : next;
      setPast((p) => [...p.slice(-60), d]);
      setFuture([]);
      return n;
    });
  }, []);

  const undo = () => {
    if (!past.length) return;
    track('undo');
    setFuture((f) => [doc, ...f]);
    setDoc(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    track('redo');
    setPast((p) => [...p, doc]);
    setDoc(future[0]);
    setFuture((f) => f.slice(1));
  };

  // ── View ─────────────────────────────────────────────
  const fit = useCallback((s: SheetMeta | null) => {
    const el = viewportRef.current;
    if (!s || !el) return;
    const z = Math.min(el.clientWidth / s.width, el.clientHeight / s.height) * 0.96;
    setView({ zoom: z, tx: (el.clientWidth - s.width * z) / 2, ty: (el.clientHeight - s.height * z) / 2 });
  }, []);
  useEffect(() => {
    fit(sheet);
    setDraft([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const x = cx ?? el.clientWidth / 2;
    const y = cy ?? el.clientHeight / 2;
    setView((v) => {
      const z = Math.min(20, Math.max(0.02, v.zoom * factor));
      const k = z / v.zoom;
      return { zoom: z, tx: x - (x - v.tx) * k, ty: y - (y - v.ty) * k };
    });
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const toImage = (clientX: number, clientY: number): Pt => {
    const r = viewportRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.tx) / view.zoom, y: (clientY - r.top - view.ty) / view.zoom };
  };

  // ── Upload ───────────────────────────────────────────
  async function onFiles(files: FileList | File[] | null, camera = false) {
    if (!files?.length) return;
    const list = Array.from(files);
    // Data collection requires agreement to the Privacy Policy before the first upload.
    if (!hasConsent()) {
      setDialog({ kind: 'consent', files: list, camera });
      return;
    }
    setError('');
    setBusy('Loading drawing…');
    try {
      const loaded = await loadFiles(list, camera, setBusy);
      for (const f of list) collectDrawing(f, f.name, { camera });
      track('drawing_uploaded', {
        files: list.map((f) => ({ name: f.name, type: f.type, bytes: f.size })),
        sheets: loaded.map((l) => ({ id: l.meta.id, source: l.meta.source, w: l.meta.width, h: l.meta.height, pxPerPaperMm: l.meta.pxPerPaperMm })),
      });
      const nextUrls = new Map(urls);
      for (const l of loaded) {
        nextUrls.set(l.meta.id, URL.createObjectURL(l.blob));
        await store.saveBlob(l.meta.id, l.blob);
      }
      setUrls(nextUrls);
      commit((d) => ({ ...d, sheets: [...d.sheets, ...loaded.map((l) => l.meta)] }));
      setActiveId(loaded[0].meta.id);
      if (loaded.some((l) => !l.meta.pxPerPaperMm)) setTool('scale');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy('');
    }
  }

  // ── Measurement creation ────────────────────────────
  const updateSheet = (id: string, patch: Partial<SheetMeta>) =>
    commit((d) => ({ ...d, sheets: d.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const updateMeasurement = (id: string, patch: Partial<Measurement>) => {
    // Corrections teach us where automatic results were wrong. Rates are commercial data — not collected.
    const { rateUsd: _rate, ...rest } = patch;
    if (Object.keys(rest).length) track('measurement_edited', { id, changes: rest });
    return commit((d) => ({ ...d, measurements: d.measurements.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  };

  const deleteMeasurement = (id: string) => {
    track('measurement_deleted', { id });
    commit((d) => ({ ...d, measurements: d.measurements.filter((m) => m.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  function addMeasurement(type: MeasureType, points: Pt[], depthM: number | null = null) {
    if (!sheet) return;
    const n = doc.measurements.filter((m) => m.type === type).length + 1;
    const m: Measurement = {
      id: uid(),
      sheetId: sheet.id,
      type,
      name: `${TYPE_LABEL[type]} ${n}`,
      description: '',
      category,
      color: categoryColor(category, doc.categories),
      timesing: 1,
      wastePct: DEFAULT_WASTE[type],
      rateUsd: 0,
      depthM,
      points,
      holes: [],
    };
    commit((d) => ({ ...d, measurements: [...d.measurements, m] }));
    setSelectedId(m.id);
    const q = rawQuantity(m, sheet);
    track('measurement_created', {
      id: m.id, sheetId: sheet.id, type, category, depthM, points,
      quantity: q, scale: scaleAt(sheet, points[0]), sheetPxPerPaperMm: sheet.pxPerPaperMm,
    });
  }

  const cleanDraft = () =>
    draft.filter((p, i) => i === 0 || dist(p, draft[i - 1]) > 3 / view.zoom);

  function finish() {
    const pts = cleanDraft();
    if (tool === 'linear' && pts.length >= 2) addMeasurement('linear', pts);
    else if (tool === 'area' && pts.length >= 3) addMeasurement('area', pts);
    else if (tool === 'count' && pts.length >= 1) addMeasurement('count', pts);
    else if (tool === 'volume' && pts.length >= 3) setDialog({ kind: 'depth', points: pts });
    else if (tool === 'cutout' && pts.length >= 3 && selected && (selected.type === 'area' || selected.type === 'volume'))
      updateMeasurement(selected.id, { holes: [...selected.holes, pts] });
    setDraft([]);
  }

  function hitTest(p: Pt): string | null {
    const tol = 10 / view.zoom;
    for (let i = sheetMeasurements.length - 1; i >= 0; i--) {
      const m = sheetMeasurements[i];
      if (m.type === 'count') {
        if (m.points.some((q) => dist(q, p) < tol * 1.5)) return m.id;
      } else if (m.type === 'linear') {
        for (let j = 1; j < m.points.length; j++) if (segDist(p, m.points[j - 1], m.points[j]) < tol) return m.id;
      } else if (pointInPoly(p, m.points)) return m.id;
    }
    return null;
  }

  function handleTap(p: Pt) {
    if (!sheet) return;
    if (tool === 'pan') return setSelectedId(hitTest(p));
    if (tool === 'region') return;
    if (tool === 'scale') {
      const next = [...draft, p];
      if (next.length === 2) {
        setDraft([]);
        setDialog({ kind: 'scale', pts: [next[0], next[1]] });
      } else setDraft(next);
      return;
    }
    if ((tool === 'area' || tool === 'volume' || tool === 'cutout') && draft.length >= 3 && dist(p, draft[0]) < 12 / view.zoom) {
      finish();
      return;
    }
    setDraft([...draft, p]);
  }

  // ── Pointer handling (mouse + touch, pan + pinch) ────
  function onPointerDown(e: React.PointerEvent) {
    if (!sheet) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = {
        moved: true,
        start: pts[0],
        view,
        pinch: { d: dist(pts[0], pts[1]), mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } },
      };
      setRegionDrag(null);
    } else {
      gesture.current = { moved: false, start: { x: e.clientX, y: e.clientY }, view };
      if (tool === 'region' && regionScale) {
        const a = toImage(e.clientX, e.clientY);
        setRegionDrag({ a, b: a });
      }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!sheet) return;
    setHover(toImage(e.clientX, e.clientY));
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    const rect = viewportRef.current!.getBoundingClientRect();
    if (g.pinch && pts.length >= 2) {
      const d = dist(pts[0], pts[1]);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const z = Math.min(20, Math.max(0.02, (g.view.zoom * d) / g.pinch.d));
      const k = z / g.view.zoom;
      const mx = g.pinch.mid.x - rect.left;
      const my = g.pinch.mid.y - rect.top;
      setView({ zoom: z, tx: mx - (mx - g.view.tx) * k + (mid.x - g.pinch.mid.x), ty: my - (my - g.view.ty) * k + (mid.y - g.pinch.mid.y) });
      return;
    }
    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    if (regionDrag) {
      setRegionDrag({ a: regionDrag.a, b: toImage(e.clientX, e.clientY) });
      g.moved = true;
      return;
    }
    if (!g.moved && Math.hypot(dx, dy) > 6) g.moved = true;
    if (g.moved) setView({ ...g.view, tx: g.view.tx + dx, ty: g.view.ty + dy });
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current;
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (regionDrag && sheet && regionScale) {
      const { a, b } = regionDrag;
      const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      setRegionDrag(null);
      if (r.w > 20 && r.h > 20) {
        updateSheet(sheet.id, { regions: [...sheet.regions, { id: uid(), ...r, scale: regionScale }] });
        track('scale_region_set', { sheetId: sheet.id, region: r, scale: regionScale });
        setRegionScale(null);
        setPendingRegion(false);
        setTool('pan');
      }
      return;
    }
    if (g && !g.moved && wasSingle) handleTap(toImage(e.clientX, e.clientY));
  }

  // ── Keyboard ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select') || dialog) return;
      if (e.key === 'Enter') finish();
      else if (e.key === 'Escape') {
        setDraft([]);
        setRegionDrag(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !draft.length) deleteMeasurement(selectedId);
      else if (e.key === 'Backspace' && draft.length) setDraft(draft.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pickTool = (t: Tool) => {
    setDraft([]);
    setRegionDrag(null);
    setPendingRegion(false);
    if (t === 'scale' && sheet) {
      setTool('scale');
      setDialog({ kind: 'scale', pts: null });
      return;
    }
    if (t === 'cutout' && !(selected && (selected.type === 'area' || selected.type === 'volume'))) {
      setError('Select an area or volume measurement first, then add a cut-out.');
      return;
    }
    setError('');
    setTool(t);
  };

  async function startOver() {
    if (!confirm('Remove all drawings and measurements from this device?')) return;
    await store.clear?.(doc);
    urls.forEach((u) => URL.revokeObjectURL(u));
    setUrls(new Map());
    setDoc(EMPTY_DOC);
    setPast([]);
    setFuture([]);
    setActiveId(null);
    setSelectedId(null);
  }

  const z = view.zoom;
  const needsScale = !!sheet && !sheet.scale && sheet.regions.length === 0;
  const drawing = ['linear', 'area', 'cutout', 'count', 'volume'].includes(tool);

  return (
    <div className="ws">
      <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFiles(e.target.files, true); e.target.value = ''; }} />

      {/* Toolbar — each former "feature" is now a button */}
      <div className="ws-toolbar" role="toolbar" aria-label="Takeoff tools">
        <ToolGroup label="Auto">
          <TBtn icon="spark" label="Auto takeoff" disabled={!doc.sheets.length} onClick={() => setDialog(hasConsent() ? { kind: 'auto' } : { kind: 'consent', files: [], camera: false, then: 'auto' })} primary />
        </ToolGroup>
        <ToolGroup label="Drawing">
          <TBtn icon="upload" label="Upload" onClick={() => fileRef.current?.click()} />
          <TBtn icon="camera" label="Photo" onClick={() => cameraRef.current?.click()} />
        </ToolGroup>
        <ToolGroup label="Scale">
          <TBtn icon="ruler" label="Set scale" active={tool === 'scale'} disabled={!sheet} onClick={() => pickTool('scale')} warn={needsScale} />
          <TBtn
            icon="region"
            label="View scale"
            active={tool === 'region'}
            disabled={!sheet}
            onClick={() => {
              setTool('scale');
              setDialog({ kind: 'scale', pts: null });
              setRegionScale(null);
              setPendingRegion(true);
            }}
          />
        </ToolGroup>
        <ToolGroup label="Measure">
          <TBtn icon="hand" label="Select" active={tool === 'pan'} disabled={!sheet} onClick={() => pickTool('pan')} />
          <TBtn icon="line" label="Linear" active={tool === 'linear'} disabled={!sheet} onClick={() => pickTool('linear')} />
          <TBtn icon="area" label="Area" active={tool === 'area'} disabled={!sheet} onClick={() => pickTool('area')} />
          <TBtn icon="cut" label="Cut-out" active={tool === 'cutout'} disabled={!sheet} onClick={() => pickTool('cutout')} />
          <TBtn icon="count" label="Count" active={tool === 'count'} disabled={!sheet} onClick={() => pickTool('count')} />
          <TBtn icon="cube" label="Volume" active={tool === 'volume'} disabled={!sheet} onClick={() => pickTool('volume')} />
        </ToolGroup>
        <ToolGroup label="Edit">
          <TBtn icon="undo" label="Undo" disabled={!past.length} onClick={undo} />
          <TBtn icon="redo" label="Redo" disabled={!future.length} onClick={redo} />
          <TBtn icon="trash" label="Delete" disabled={!selected} onClick={() => selected && deleteMeasurement(selected.id)} />
        </ToolGroup>
        <ToolGroup label="Units">
          <TBtn icon="units" label={prefs.units === 'metric' ? 'Metric' : 'Imperial'} onClick={() => setPrefs({ ...prefs, units: prefs.units === 'metric' ? 'imperial' : 'metric' })} />
          <TBtn icon="cash" label={prefs.currency} onClick={() => setPrefs({ ...prefs, currency: prefs.currency === 'USD' ? 'ZMW' : 'USD' })} />
        </ToolGroup>
        <ToolGroup label="Results">
          <TBtn icon="sheet" label="Dim. paper" active={panelTab === 'dims'} onClick={() => setPanelTab('dims')} />
          <TBtn icon="boq" label="BOQ" active={panelTab === 'boq'} onClick={() => setPanelTab('boq')} />
          <TBtn icon="download" label="Export" disabled={!doc.measurements.length} onClick={() => { track('export_clicked', { measurements: doc.measurements.length }); setDialog({ kind: 'export' }); }} primary />
        </ToolGroup>
      </div>

      <div className="ws-body">
        <div className="ws-stage">
          {doc.sheets.length > 1 && (
            <div className="ws-sheets" role="tablist">
              {doc.sheets.map((s) => (
                <button key={s.id} role="tab" aria-selected={s.id === activeId} className={s.id === activeId ? 'active' : ''} onClick={() => setActiveId(s.id)}>
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <div className={`ws-hint ${needsScale && !drawing && tool !== 'scale' ? 'warn' : ''}`}>
            {busy || error || (!sheet ? 'Upload a drawing to start — no account needed.' : needsScale && tool === 'pan' ? (doc.measurements.some((m) => m.source !== 'auto') ? 'Set the scale first so lengths and areas you draw are correct.' : 'Tap ✦ Auto takeoff to calculate the takeoff from the dimensions on the drawing — or set the scale to measure by hand.') : pendingRegion && tool === 'region' ? HINTS.region : HINTS[tool])}
          </div>

          <div
            ref={viewportRef}
            className={`ws-viewport tool-${tool}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={() => drawing && finish()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFiles(e.dataTransfer.files);
            }}
          >
            {!sheet ? (
              <div className="ws-drop">
                <svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <h3>Drop a drawing here</h3>
                <p className="muted">PDF (every page becomes a sheet), PNG or JPG</p>
                <div className="ws-drop-btns">
                  <button className="btn btn-accent" onClick={() => fileRef.current?.click()}>Upload drawing</button>
                  <button className="btn btn-secondary" onClick={() => cameraRef.current?.click()}>Take a photo</button>
                </div>
                <p className="muted small">Your drawing stays on this device. Nothing is sent to us until you choose to save to an account.</p>
              </div>
            ) : (
              <div className="ws-canvas" style={{ width: sheet.width, height: sheet.height, transform: `translate(${view.tx}px, ${view.ty}px) scale(${z})` }}>
                <img src={urls.get(sheet.id)} width={sheet.width} height={sheet.height} alt={sheet.name} draggable={false} />
                <svg className="ws-overlay" width={sheet.width} height={sheet.height} viewBox={`0 0 ${sheet.width} ${sheet.height}`}>
                  {showViews &&
                    doc.auto?.views
                      .filter((v) => v.sheetId === sheet.id)
                      .map((v, i) => {
                        const [x0, y0, x1, y1] = v.bbox;
                        return (
                          <g key={`view-${i}`} className={`view-box kind-${v.kind}`}>
                            <rect x={x0 * sheet.width} y={y0 * sheet.height} width={(x1 - x0) * sheet.width} height={(y1 - y0) * sheet.height} fill="none" strokeWidth={2} strokeDasharray="10 6" vectorEffect="non-scaling-stroke" />
                            <Label x={x0 * sheet.width + 6 / z} y={y0 * sheet.height + 16 / z} z={z} color={VIEW_COLOR[v.kind]} anchor="start">
                              {`${VIEW_LABEL[v.kind].toUpperCase()} · ${v.name}${v.scaleLabel ? ` · ${v.scaleLabel}` : ''}`}
                            </Label>
                          </g>
                        );
                      })}
                  {sheet.regions.map((r) => (
                    <g key={r.id}>
                      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(37,99,235,0.04)" stroke="#2563EB" strokeDasharray="8 6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                      <Label x={r.x + 6 / z} y={r.y + 18 / z} z={z} color="#2563EB" anchor="start">{r.scale.label}</Label>
                    </g>
                  ))}
                  {sheetMeasurements.filter((m) => m.points.length > 0).map((m) => (
                    <Shape key={m.id} m={m} sheet={sheet} z={z} selected={m.id === selectedId} units={prefs.units} />
                  ))}
                  <Draft tool={tool} pts={draft} hover={hover} z={z} color={tool === 'scale' ? '#2563EB' : tool === 'cutout' ? '#DC2626' : categoryColor(category, doc.categories)} />
                  {regionDrag && (
                    <rect
                      x={Math.min(regionDrag.a.x, regionDrag.b.x)}
                      y={Math.min(regionDrag.a.y, regionDrag.b.y)}
                      width={Math.abs(regionDrag.a.x - regionDrag.b.x)}
                      height={Math.abs(regionDrag.a.y - regionDrag.b.y)}
                      fill="rgba(37,99,235,0.08)"
                      stroke="#2563EB"
                      strokeDasharray="8 6"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
              </div>
            )}

            {sheet && (
              <div className="ws-zoom" onPointerDown={(e) => e.stopPropagation()}>
                <button onClick={() => zoomAt(1.25)} aria-label="Zoom in">+</button>
                <button onClick={() => zoomAt(0.8)} aria-label="Zoom out">−</button>
                <button onClick={() => fit(sheet)} aria-label="Fit to screen">⤢</button>
              </div>
            )}
            {drawing && draft.length > 0 && (
              <div className="ws-finish" onPointerDown={(e) => e.stopPropagation()}>
                <button className="btn btn-secondary" onClick={() => setDraft(draft.slice(0, -1))}>Back</button>
                <button className="btn btn-secondary" onClick={() => setDraft([])}>Cancel</button>
                <button className="btn btn-primary" onClick={finish}>Finish</button>
              </div>
            )}
          </div>

          <div className="ws-status">
            {status ?? <span className="ok-dot">● Saved on this device</span>}
            {sheet && <span className="muted">{sheet.scale ? `Sheet scale ${sheet.scale.label}` : 'No sheet scale'}{sheet.regions.length ? ` · ${sheet.regions.length} view scale${sheet.regions.length > 1 ? 's' : ''}` : ''}</span>}
            {!!doc.auto?.views.some((v) => v.sheetId === activeId) && (
              <label className="views-toggle"><input type="checkbox" checked={showViews} onChange={(e) => setShowViews(e.target.checked)} /> Show views</label>
            )}
            {doc.sheets.length > 0 && store.clear && <button className="linklike" onClick={startOver}>Start over</button>}
          </div>
        </div>

        <Panel
          doc={doc}
          tab={panelTab}
          setTab={setPanelTab}
          selectedId={selectedId}
          setSelectedId={(id) => {
            setSelectedId(id);
            const m = doc.measurements.find((x) => x.id === id);
            if (m && m.sheetId !== activeId) setActiveId(m.sheetId);
          }}
          category={category}
          setCategory={setCategory}
          prefs={prefs}
          setRate={(r) => setPrefs({ ...prefs, zmwPerUsd: r })}
          update={updateMeasurement}
          remove={deleteMeasurement}
          addCategory={(c) => commit((d) => ({ ...d, categories: [...d.categories, c] }))}
          answerQuery={(id, answer) =>
            commit((d) => (d.auto ? { ...d, auto: { ...d.auto, queries: d.auto.queries.map((q) => (q.id === id ? { ...q, answer } : q)) } } : d))
          }
          onRerun={() => setDialog(hasConsent() ? { kind: 'auto', rerun: true } : { kind: 'consent', files: [], camera: false, then: 'auto' })}
        />
      </div>

      {dialog?.kind === 'scale' && sheet && (
        <ScaleDialog
          sheet={sheet}
          pts={dialog.pts}
          forRegion={pendingRegion}
          units={prefs.units}
          onCalibrate={() => {
            setDialog(null);
            setTool('scale');
            setDraft([]);
          }}
          onCancel={() => {
            setDialog(null);
            setPendingRegion(false);
            setTool('pan');
          }}
          onApply={(s) => {
            track('scale_set', {
              sheetId: sheet.id, label: s.label, mPerPx: s.mPerPx, forRegion: pendingRegion,
              method: dialog.pts ? 'calibrated' : 'preset', pickedPx: dialog.pts ? dist(dialog.pts[0], dialog.pts[1]) : null,
              pickedPts: dialog.pts, pxPerPaperMm: sheet.pxPerPaperMm,
            });
            setDialog(null);
            if (pendingRegion) {
              setRegionScale(s);
              setPendingRegion(true);
              setTool('region');
            } else {
              updateSheet(sheet.id, { scale: s });
              setTool('pan');
            }
          }}
        />
      )}
      {dialog?.kind === 'auto' && (
        <AutoDialog
          doc={doc}
          urls={urls}
          loggedIn={!!user}
          activeId={activeId}
          projectName={projectName}
          rerun={dialog.rerun}
          onClose={() => setDialog(null)}
          onViews={(views, facts, sheetIds) => {
            // Show the views on the drawing as soon as step 1 finishes.
            commit((d) => ({
              ...d,
              auto: { ...(d.auto ?? { keyFigures: [], queries: [], summary: '', runAt: '' }), views, facts, sheetIds },
            }));
            setShowViews(true);
          }}
          onApply={(ms, categories, auto, replaceAuto) => {
            commit((d) => ({
              ...d,
              categories,
              auto,
              measurements: [...d.measurements.filter((m) => !(replaceAuto && m.source === 'auto')), ...ms],
            }));
            setDialog(null);
            setPanelTab(auto.queries.some((q) => !q.answer) ? 'queries' : 'dims');
          }}
        />
      )}
      {dialog?.kind === 'consent' && (
        <ConsentDialog
          onCancel={() => setDialog(null)}
          onAccepted={() => {
            const { files, camera, then } = dialog;
            setDialog(then === 'auto' ? { kind: 'auto' } : null);
            trackSessionStart();
            if (files.length) onFiles(files, camera);
          }}
        />
      )}
      {dialog?.kind === 'depth' && (
        <DepthDialog
          units={prefs.units}
          onCancel={() => setDialog(null)}
          onApply={(d) => {
            addMeasurement('volume', dialog.points, d);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'export' && (
        <Modal title="Export results" onClose={() => setDialog(null)}>
          {user ? (
            <p>Marked-up drawing (PNG/PDF) and Excel/PDF tables arrive in Stage 4. Your on-screen dimension paper and BOQ are ready now.</p>
          ) : (
            <>
              <p>
                Create a <strong>free account</strong> to export the marked-up drawing (PNG/PDF) and the dimension paper / BOQ (Excel/PDF). It's free.
              </p>
              <p className="muted small">Your drawing and measurements stay saved on this device while you sign up.</p>
              <div className="modal-actions">
                <Link to="/signup" className="btn btn-accent">Create free account</Link>
                <Link to="/login" className="btn btn-secondary">Log in</Link>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

// ── Small presentational pieces ─────────────────────────
function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tgroup" role="group" aria-label={label}>
      <span className="tgroup-label">{label}</span>
      <div className="tgroup-btns">{children}</div>
    </div>
  );
}

const VIEW_COLOR: Record<string, string> = {
  plan: '#2563EB',
  elevation: '#9333EA',
  section: '#DC2626',
  schedule: '#0891B2',
  detail: '#CA8A04',
  notes: '#64748B',
  title_block: '#64748B',
};

const ICONS: Record<string, string> = {
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  ruler: 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  region: 'M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6M9 12h6',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-7a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14a1.5 1.5 0 0 1 2.5-1.6L8 15',
  line: 'M4 18 10 8l5 6 5-9M4 18h0M10 8h0M15 14h0M20 5h0',
  area: 'M4 7l8-4 8 5-2 11H6z',
  cut: 'M4 4h16v16H4zM9 9h6v6H9z',
  count: 'M6 7a2 2 0 1 0 0 .01M18 7a2 2 0 1 0 0 .01M6 17a2 2 0 1 0 0 .01M18 17a2 2 0 1 0 0 .01',
  cube: 'M12 3 4 7v10l8 4 8-4V7zM4 7l8 4 8-4M12 11v10',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  units: 'M3 12h18M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  cash: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  sheet: 'M5 3h14v18H5zM9 3v18M5 8h14M5 13h14',
  boq: 'M4 4h16v16H4zM4 9h16M9 9v11M4 14h16',
  download: 'M12 4v12m0 0-4-4m4 4 4-4M4 20h16',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
};

function TBtn({ icon, label, onClick, active, disabled, warn, primary }: { icon: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean; warn?: boolean; primary?: boolean }) {
  return (
    <button type="button" className={`tbtn${active ? ' active' : ''}${warn ? ' warn' : ''}${primary ? ' primary' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={active} title={label}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d={ICONS[icon]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

function Label({ x, y, z, color, children, anchor = 'middle' }: { x: number; y: number; z: number; color: string; children: ReactNode; anchor?: 'start' | 'middle' }) {
  return (
    <text x={x} y={y} fontSize={13 / z} fontWeight={700} fill={color} textAnchor={anchor} stroke="#fff" strokeWidth={4 / z} paintOrder="stroke" style={{ pointerEvents: 'none' }}>
      {children}
    </text>
  );
}

const pts2 = (p: Pt[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

function Shape({ m, sheet, z, selected, units }: { m: Measurement; sheet: SheetMeta; z: number; selected: boolean; units: UnitSystem }) {
  const q = rawQuantity(m, sheet);
  const text = q == null ? 'no scale' : `${fmt(toDisplay(q, m.type, units))} ${unitLabel(m.type, units)}`;
  const sw = selected ? 4.5 : 2.5;
  if (m.type === 'count') {
    return (
      <g>
        {m.points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={(selected ? 9 : 7) / z} fill={m.color} stroke="#fff" strokeWidth={2 / z} />
            <text x={p.x} y={p.y + 3.5 / z} fontSize={9 / z} fontWeight={700} fill="#fff" textAnchor="middle" style={{ pointerEvents: 'none' }}>{i + 1}</text>
          </g>
        ))}
        <Label x={m.points[0].x} y={m.points[0].y - 12 / z} z={z} color={m.color}>{`${m.name}: ${m.points.length}`}</Label>
      </g>
    );
  }
  if (m.type === 'linear') {
    const mid = m.points[Math.floor((m.points.length - 1) / 2)];
    const nxt = m.points[Math.floor((m.points.length - 1) / 2) + 1] ?? mid;
    return (
      <g>
        <polyline points={pts2(m.points)} fill="none" stroke={m.color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {selected && m.points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4 / z} fill="#fff" stroke={m.color} strokeWidth={2 / z} />)}
        <Label x={(mid.x + nxt.x) / 2} y={(mid.y + nxt.y) / 2 - 8 / z} z={z} color={m.color}>{text}</Label>
      </g>
    );
  }
  const c = centroid(m.points);
  const d = [m.points, ...m.holes].map((ring) => `M${ring.map((p) => `${p.x} ${p.y}`).join('L')}Z`).join(' ');
  return (
    <g>
      <path d={d} fill={m.color} fillOpacity={selected ? 0.32 : 0.2} fillRule="evenodd" stroke={m.color} strokeWidth={sw} strokeDasharray={m.type === 'volume' ? '10 5' : undefined} vectorEffect="non-scaling-stroke" />
      {m.holes.map((h, i) => (
        <polygon key={i} points={pts2(h)} fill="none" stroke="#DC2626" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      ))}
      <Label x={c.x} y={c.y} z={z} color={m.color}>{text}</Label>
    </g>
  );
}

function Draft({ tool, pts, hover, z, color }: { tool: Tool; pts: Pt[]; hover: Pt | null; z: number; color: string }) {
  if (!pts.length) return null;
  if (tool === 'count') return <>{pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={7 / z} fill={color} stroke="#fff" strokeWidth={2 / z} />)}</>;
  const all = hover ? [...pts, hover] : pts;
  const closed = tool === 'area' || tool === 'volume' || tool === 'cutout';
  return (
    <g style={{ pointerEvents: 'none' }}>
      {closed && all.length > 2 && <polygon points={pts2(all)} fill={color} fillOpacity={0.12} stroke="none" />}
      <polyline points={pts2(all)} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={(i === 0 && closed ? 6 : 4) / z} fill="#fff" stroke={color} strokeWidth={2 / z} />
      ))}
    </g>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ScaleDialog({ sheet, pts, forRegion, units, onCalibrate, onApply, onCancel }: { sheet: SheetMeta; pts: [Pt, Pt] | null; forRegion: boolean; units: UnitSystem; onCalibrate: () => void; onApply: (s: Scale) => void; onCancel: () => void }) {
  const [len, setLen] = useState('');
  const [unit, setUnit] = useState<'mm' | 'm' | 'ft' | 'in'>(units === 'metric' ? 'mm' : 'ft');
  const [dpi, setDpi] = useState('150');
  const pxPerPaperMm = sheet.pxPerPaperMm ?? Number(dpi) / 25.4;
  const toM = { mm: 0.001, m: 1, ft: 0.3048, in: 0.0254 };

  return (
    <Modal title={forRegion ? 'Scale for one view' : 'Set sheet scale'} onClose={onCancel}>
      {pts ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(len);
            if (!(v > 0)) return;
            const meters = v * toM[unit];
            onApply({ mPerPx: meters / dist(pts[0], pts[1]), label: `Calibrated (${len} ${unit})` });
          }}
        >
          <p className="muted">You picked a line {Math.round(dist(pts[0], pts[1]))} px long. What is its real length?</p>
          <div className="grid-2">
            <label>
              Real length
              <input autoFocus inputMode="decimal" value={len} onChange={(e) => setLen(e.target.value)} placeholder={unit === 'mm' ? 'e.g. 11950' : 'e.g. 12'} />
            </label>
            <label>
              Unit
              <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
                <option value="mm">mm</option>
                <option value="m">m</option>
                <option value="ft">ft</option>
                <option value="in">in</option>
              </select>
            </label>
          </div>
          <button className="btn btn-primary">Apply scale</button>
        </form>
      ) : (
        <>
          <button className="btn btn-primary btn-block" onClick={onCalibrate}>Calibrate: tap two ends of a known dimension</button>
          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            Most accurate. Use a long dimension string, e.g. the 11 950 overall.
          </p>
          <div className="divider"><span>or pick the drawing scale</span></div>
          <p className="banner warn small">
            Presets are only correct if the PDF is at true size. Many PDFs are “fit to page” (e.g. an A1 drawing printed on A3), so a 1:50 label can be wrong — after picking a preset, measure a known dimension to check, or calibrate instead.
          </p>
          {!sheet.pxPerPaperMm && (
            <label className="form" style={{ marginBottom: '0.75rem' }}>
              <span className="small">Image resolution (DPI) — needed for presets on photos/scans</span>
              <input inputMode="numeric" value={dpi} onChange={(e) => setDpi(e.target.value)} />
            </label>
          )}
          <div className="preset-grid">
            {(units === 'metric' ? METRIC_PRESETS.map((r) => ({ label: `1:${r}`, ratio: r })) : IMPERIAL_PRESETS).map((p) => (
              <button key={p.label} className="btn btn-secondary" onClick={() => onApply({ ...presetScale(p.ratio, pxPerPaperMm), label: p.label })}>
                {p.label}
              </button>
            ))}
          </div>
          {forRegion && <p className="muted small" style={{ marginTop: '0.75rem' }}>After choosing, drag a box around the view that uses this scale.</p>}
          <p className="muted small" style={{ marginTop: '0.5rem' }}>Lengths shown in {units === 'metric' ? 'metres' : 'feet'}: e.g. 1 px = {fmt(lenDisplay(presetScale(50, pxPerPaperMm).mPerPx, units), 4)} at 1:50.</p>
        </>
      )}
    </Modal>
  );
}

function DepthDialog({ units, onApply, onCancel }: { units: UnitSystem; onApply: (m: number) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  const [unit, setUnit] = useState<'mm' | 'm' | 'in' | 'ft'>(units === 'metric' ? 'mm' : 'in');
  const toM = { mm: 0.001, m: 1, ft: 0.3048, in: 0.0254 };
  return (
    <Modal title="Depth / thickness" onClose={onCancel}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(v);
          if (n > 0) onApply(n * toM[unit]);
        }}
      >
        <p className="muted">Volume = area × depth (e.g. 100 mm slab, 150 mm topsoil, 750 mm trench).</p>
        <div className="grid-2">
          <label>
            Depth
            <input autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} />
          </label>
          <label>
            Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
              <option value="mm">mm</option>
              <option value="m">m</option>
              <option value="in">in</option>
              <option value="ft">ft</option>
            </select>
          </label>
        </div>
        <button className="btn btn-primary">Create volume</button>
      </form>
    </Modal>
  );
}

// ── Hit-testing helpers ─────────────────────────────────
function segDist(p: Pt, a: Pt, b: Pt) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!l2) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

function pointInPoly(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside && polygonArea(poly) > 0;
}
