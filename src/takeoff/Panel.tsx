import { useState, type ReactNode } from 'react';
import {
  fmt,
  lenDisplay,
  money,
  netQuantity,
  polygonArea,
  polylineLength,
  rateFromDisplayUnit,
  rateToDisplayUnit,
  rawQuantity,
  rectSides,
  scaleAt,
  toDisplay,
  unitFor,
} from './geometry';
import type { AutoQuery, Currency, Measurement, SheetMeta, TakeoffDoc, UnitSystem } from './types';

export type PanelTab = 'items' | 'dims' | 'boq' | 'queries';

/** Taking-off headings in order (matches the Auto takeoff prompt). */
const ELEMENTS = ['Substructure', 'Walls', 'Floors', 'Windows & Doors', 'Internal Finishes', 'External Finishes', 'Metalwork', 'Roof', 'Reinforced Concrete', 'Services', 'External Works'];
type Prefs = { units: UnitSystem; currency: Currency; zmwPerUsd: number };

type Props = {
  doc: TakeoffDoc;
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  category: string;
  setCategory: (c: string) => void;
  prefs: Prefs;
  setRate: (zmwPerUsd: number) => void;
  update: (id: string, patch: Partial<Measurement>) => void;
  remove: (id: string) => void;
  addCategory: (c: string) => void;
  answerQuery: (id: string, answer: string) => void;
  onRerun: () => void;
};

/** Quantity after timesing, in display units. */
function qty(m: Measurement, sheet: SheetMeta | undefined, units: UnitSystem) {
  if (!sheet) return null;
  const q = netQuantity(m, sheet);
  return q == null ? null : toDisplay(q, m.type, units);
}

export default function Panel(p: Props) {
  const sheetOf = (m: Measurement) => p.doc.sheets.find((s) => s.id === m.sheetId);
  const queries = p.doc.auto?.queries ?? [];
  const open = queries.filter((q) => !q.answer?.trim()).length;
  return (
    <aside className="ws-panel">
      <div className="tabs" role="tablist">
        {(
          [
            ['items', `Measurements (${p.doc.measurements.length})`],
            ['dims', 'Dimension paper'],
            ['boq', 'BOQ'],
            ...(queries.length ? [['queries', `⚠ Queries (${open})`] as const] : []),
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={p.tab === k} className={`${p.tab === k ? 'tab active' : 'tab'}${k === 'queries' && open ? ' tab-warn' : ''}`} onClick={() => p.setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="ws-panel-body">
        {p.tab === 'items' && <Items {...p} sheetOf={sheetOf} />}
        {p.tab === 'dims' && <DimPaper doc={p.doc} units={p.prefs.units} sheetOf={sheetOf} />}
        {p.tab === 'boq' && <Boq doc={p.doc} prefs={p.prefs} setRate={p.setRate} sheetOf={sheetOf} />}
        {p.tab === 'queries' && <Queries queries={queries} doc={p.doc} answer={p.answerQuery} onRerun={p.onRerun} />}
      </div>
    </aside>
  );
}

// ── Measurements list + editor ─────────────────────────
function Items(p: Props & { sheetOf: (m: Measurement) => SheetMeta | undefined }) {
  const [newCat, setNewCat] = useState('');
  const { units, currency, zmwPerUsd } = p.prefs;
  return (
    <div className="items">
      <label className="field">
        <span>New measurements go to</span>
        <select value={p.category} onChange={(e) => p.setCategory(e.target.value)}>
          {p.doc.categories.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <form
        className="add-cat"
        onSubmit={(e) => {
          e.preventDefault();
          const c = newCat.trim();
          if (c && !p.doc.categories.includes(c)) {
            p.addCategory(c);
            p.setCategory(c);
          }
          setNewCat('');
        }}
      >
        <input placeholder="Add a category…" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
        <button className="btn btn-secondary" disabled={!newCat.trim()}>Add</button>
      </form>

      {!p.doc.measurements.length && <p className="muted small">No measurements yet. Pick Linear, Area, Count or Volume and tap on the drawing.</p>}

      <ul className="mlist">
        {p.doc.measurements.map((m) => {
          const q = qty(m, p.sheetOf(m), units);
          const open = m.id === p.selectedId;
          const rateDisp = rateToDisplayUnit(m.rateUsd, m.type, units) * (currency === 'ZMW' ? zmwPerUsd : 1);
          return (
            <li key={m.id} className={open ? 'open' : ''}>
              <button className="mrow" onClick={() => p.setSelectedId(open ? null : m.id)}>
                <span className="swatch" style={{ background: m.color }} />
                <span className="mname">
                  {m.source === 'auto' && <span className={`auto-tag ${m.confidence ?? ''}`} title={`Auto takeoff — ${m.confidence ?? ''} confidence`}>AUTO</span>}
                  {m.deduct && <span className="ddt-tag">Ddt</span>}
                  {m.queryIds?.length ? <span className="q-ref" title="Depends on figures the engineer should confirm">⚠ </span> : null}
                  {m.name}
                </span>
                <span className="mqty">{q == null ? <em>set scale</em> : `${fmt(q)} ${unitFor(m, units)}`}</span>
              </button>
              {open && (
                <div className="medit">
                  <label className="field"><span>Name</span><input value={m.name} onChange={(e) => p.update(m.id, { name: e.target.value })} /></label>
                  {m.dims && (
                    <label className="field">
                      <span>Dimensions (metres; quantity = timesing × dims multiplied)</span>
                      <input
                        defaultValue={m.dims.map((d) => +d.toFixed(3)).join(' × ')}
                        key={`${m.id}-dims-${m.dims.join(',')}`}
                        onBlur={(e) => {
                          const dims = e.target.value.split(/[x×*,;s]+/).map(Number).filter((n) => n > 0);
                          if (dims.length) p.update(m.id, { dims });
                        }}
                      />
                    </label>
                  )}
                  {m.working && <p className="small muted working"><strong>Working:</strong> {m.working}{m.ref ? ` — ${m.ref}` : ''}</p>}
                  <label className="field"><span>Description (SMM)</span><textarea rows={2} value={m.description} placeholder="e.g. 200mm blockwork in cement-sand (1:3) mortar" onChange={(e) => p.update(m.id, { description: e.target.value })} /></label>
                  <div className="grid-2">
                    <label className="field"><span>Category</span>
                      <select value={m.category} onChange={(e) => p.update(m.id, { category: e.target.value })}>
                        {p.doc.categories.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </label>
                    <label className="field"><span>Colour</span><input type="color" value={m.color} onChange={(e) => p.update(m.id, { color: e.target.value })} /></label>
                    <label className="field"><span>Timesing (×)</span><input type="number" min="0" step="any" value={m.timesing} onChange={(e) => p.update(m.id, { timesing: Number(e.target.value) || 0 })} /></label>
                    <label className="field"><span>Waste %</span><input type="number" min="0" step="any" value={m.wastePct} onChange={(e) => p.update(m.id, { wastePct: Number(e.target.value) || 0 })} /></label>
                    <label className="field"><span>Rate ({currency}/{unitFor(m, units)})</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        defaultValue={rateDisp ? Number(rateDisp.toFixed(4)) : ''}
                        key={`${m.id}-${currency}-${units}-${zmwPerUsd}`}
                        onBlur={(e) => {
                          const v = Number(e.target.value) || 0;
                          const usd = rateFromDisplayUnit(currency === 'ZMW' ? v / zmwPerUsd : v, m.type, units);
                          p.update(m.id, { rateUsd: usd });
                        }}
                      />
                    </label>
                    {m.type === 'volume' && (
                      <label className="field"><span>Depth ({units === 'metric' ? 'm' : 'ft'})</span>
                        <input type="number" min="0" step="any" defaultValue={Number(lenDisplay(m.depthM ?? 0, units).toFixed(4))} key={`${m.id}-d-${units}`} onBlur={(e) => p.update(m.id, { depthM: (Number(e.target.value) || 0) / (units === 'metric' ? 1 : 3.28084) })} />
                      </label>
                    )}
                  </div>
                  {m.holes.length > 0 && (
                    <p className="small muted">
                      {m.holes.length} cut-out{m.holes.length > 1 ? 's' : ''} deducted.{' '}
                      <button className="linklike" onClick={() => p.update(m.id, { holes: m.holes.slice(0, -1) })}>Remove last</button>
                    </p>
                  )}
                  <button className="btn btn-ghost danger" onClick={() => p.remove(m.id)}>Delete measurement</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── SMM dimension paper ────────────────────────────────
type DimRow = { times?: string; dim?: string; sq?: string; unit?: string; desc?: ReactNode; ddt?: boolean; total?: boolean };

function dimRows(m: Measurement, sheet: SheetMeta, units: UnitSystem): DimRow[] {
  const s = scaleAt(sheet, m.points[0]);
  const u = unitFor(m, units);
  const times = m.timesing && m.timesing !== 1 ? `${fmt(m.timesing, m.timesing % 1 ? 2 : 0)}/` : undefined;
  const desc = (
    <>
      <strong>{m.name}</strong>
      {m.description && <div>{m.description}</div>}
    </>
  );
  if (m.dims?.length) {
    // Auto takeoff: dims are metres (or counts) read from the drawing's own dimensions.
    const one = (d: number) => (m.type === 'count' ? fmt(d, d % 1 ? 2 : 0) : fmt(lenDisplay(d, units)));
    const total = rawQuantity(m, sheet)! * (m.timesing || 1);
    const rows: DimRow[] = m.dims.map((d, i) => ({
      times: i === 0 ? times : undefined,
      dim: one(d),
      desc: i === 0 ? (
        <>
          {m.deduct && !/^ddt/i.test(m.name) && <strong className="ddt-word">Ddt </strong>}
          {desc}
          {m.working && <div className="muted small">{m.working}</div>}
          {m.queryIds?.length ? <div className="q-ref">⚠ Estimated — see {m.queryIds.join(', ')}</div> : null}
        </>
      ) : undefined,
      ddt: m.deduct,
    }));
    rows[rows.length - 1] = {
      ...rows[rows.length - 1],
      sq: (m.deduct ? '(' : '') + fmt(m.type === 'count' ? total : toDisplay(total, m.type, units), m.type === 'count' && total % 1 === 0 ? 0 : 2) + (m.deduct ? ')' : ''),
      unit: u,
    };
    return rows;
  }
  const L = (px: number) => fmt(lenDisplay(px * s!.mPerPx, units));
  if (m.type === 'count') return [{ times, dim: String(m.points.length), sq: fmt(m.points.length * (m.timesing || 1), 0), unit: u, desc }];
  if (!s) return [{ times, dim: '—', sq: 'no scale', unit: u, desc }];
  const q = rawQuantity(m, sheet)!;
  const sq = fmt(toDisplay(q * (m.timesing || 1), m.type, units));
  if (m.type === 'linear') return [{ times, dim: L(polylineLength(m.points)), sq, unit: u, desc }];

  const rows: DimRow[] = [];
  const rect = m.holes.length ? null : rectSides(m.points);
  const areaDisp = (px2: number) => fmt(toDisplay(px2 * s.mPerPx ** 2, 'area', units));
  if (rect) {
    rows.push({ times, dim: L(Math.max(...rect)), desc });
    rows.push({ dim: L(Math.min(...rect)) });
  } else {
    rows.push({ times, dim: areaDisp(polygonArea(m.points)), desc: <>{desc}<div className="muted">(irregular area, {m.points.length} pts)</div></> });
    m.holes.forEach((h, i) => rows.push({ dim: areaDisp(polygonArea(h)), desc: `Ddt opening ${i + 1}`, ddt: true }));
  }
  if (m.type === 'volume') rows.push({ dim: fmt(lenDisplay(m.depthM ?? 0, units)) });
  rows[rows.length - 1] = { ...rows[rows.length - 1], sq, unit: u };
  return rows;
}

function DimPaper({ doc, units, sheetOf }: { doc: TakeoffDoc; units: UnitSystem; sheetOf: (m: Measurement) => SheetMeta | undefined }) {
  if (!doc.measurements.length) return <p className="muted small">Your take-off sheet (Timesing · Dimension · Squaring · Unit · Description) builds here as you measure.</p>;
  // Auto takeoff items follow the elemental taking-off order; hand-drawn items group by work section after them.
  const groups: Array<{ title: string; items: Measurement[]; elem: boolean }> = [];
  for (const e of ELEMENTS) {
    const items = doc.measurements.filter((m) => m.element === e).sort((x, y) => (x.step ?? 0) - (y.step ?? 0));
    if (items.length) groups.push({ title: e, items, elem: true });
  }
  const otherElems = [...new Set(doc.measurements.map((m) => m.element).filter((e): e is string => !!e && !ELEMENTS.includes(e)))];
  for (const e of otherElems) groups.push({ title: e, items: doc.measurements.filter((m) => m.element === e), elem: true });
  for (const c of doc.categories) {
    const items = doc.measurements.filter((m) => !m.element && m.category === c);
    if (items.length) groups.push({ title: c, items, elem: false });
  }
  const kf = doc.auto?.keyFigures ?? [];
  return (
    <div className="table-wrap">
      <table className="dimpaper">
        <thead>
          <tr><th>Times</th><th>Dim.</th><th>Squaring</th><th>Unit</th><th>Description</th></tr>
        </thead>
        <tbody>
          {kf.length > 0 && (
            <>
              <tr className="elem-row"><td colSpan={5}>KEY FIGURES · WASTE CALCULATIONS</td></tr>
              {kf.map((k, i) => (
                <tr key={`kf-${i}`} className="kf-block item-end">
                  <td />
                  <td />
                  <td className="c-num c-sq">{fmt(k.unit === 'm' ? lenDisplay(k.value, units) : k.value)}</td>
                  <td>{k.unit === 'm' && units === 'imperial' ? 'ft' : k.unit.replace('m2', 'm²').replace('m3', 'm³')}</td>
                  <td className="c-desc">
                    <strong>{k.label}</strong>
                    <div className="kf-working small">{k.working}</div>
                    {k.queryIds.length > 0 && <div className="q-ref">⚠ Estimated — see {k.queryIds.join(', ')}</div>}
                  </td>
                </tr>
              ))}
            </>
          )}
          {groups.map((g) => (
            <CatBlock key={(g.elem ? 'e:' : 'c:') + g.title} title={g.title} cols={5} elem={g.elem}>
              {g.items.map((m) => {
                const sh = sheetOf(m);
                if (!sh) return null;
                return dimRows(m, sh, units).map((r, i, arr) => (
                  <tr key={`${m.id}-${i}`} className={`${r.ddt ? 'ddt' : ''}${i === arr.length - 1 ? ' item-end' : ''}`}>
                    <td className="c-times">{r.times}</td>
                    <td className="c-num">{r.dim}</td>
                    <td className="c-num c-sq">{r.sq}</td>
                    <td>{r.unit}</td>
                    <td className="c-desc">{r.desc}</td>
                  </tr>
                ));
              })}
            </CatBlock>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Queries({ queries, doc, answer, onRerun }: { queries: AutoQuery[]; doc: TakeoffDoc; answer: (id: string, a: string) => void; onRerun: () => void }) {
  // Typed answers count immediately; they are saved on blur and flushed before a re-run.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const valueOf = (q: AutoQuery) => (q.id in drafts ? drafts[q.id] : q.answer ?? '');
  const answered = queries.filter((q) => valueOf(q).trim()).length;
  const flush = () => {
    for (const q of queries) if (q.id in drafts && drafts[q.id].trim() !== (q.answer ?? '')) answer(q.id, drafts[q.id].trim());
    setDrafts({});
  };
  const uses = (id: string) => doc.measurements.filter((m) => m.queryIds?.includes(id)).map((m) => m.name);
  return (
    <div className="queries">
      <p className="small muted">
        Auto takeoff estimated these figures because they were not clear on the drawings. Answer what you can (for example: foundation depth 900 mm below
        ground level), then re-run — the takeoff is measured again using your answers.
      </p>
      {queries.map((q) => (
        <div key={q.id} className={`query${valueOf(q).trim() ? ' answered' : ''}`}>
          <div className="query-head">
            <span className="query-id">{q.id}</span>
            <strong>{q.question}</strong>
          </div>
          {q.why && <p className="muted">{q.why}</p>}
          <p><span className="muted">Assumed:</span> {q.assumed}{q.ref ? <span className="muted"> · {q.ref}</span> : null}</p>
          <p className="muted small">Affects: {uses(q.id).join(', ') || q.affects}</p>
          <textarea
            placeholder="Your answer (leave empty to keep the assumption)"
            value={valueOf(q)}
            onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })}
            onBlur={flush}
          />
        </div>
      ))}
      <button
        className="btn btn-accent"
        disabled={!answered}
        onClick={() => {
          flush();
          // Let the saved answers reach the document before the re-run dialog reads them.
          setTimeout(onRerun, 0);
        }}
      >
        Re-run auto takeoff with {answered} answer{answered === 1 ? '' : 's'}
      </button>
    </div>
  );
}

function CatBlock({ title, cols, children, elem }: { title: string; cols: number; children: ReactNode; elem?: boolean }) {
  return (
    <>
      <tr className={elem ? 'elem-row' : 'cat-row'}><td colSpan={cols}>{title.toUpperCase()}</td></tr>
      {children}
    </>
  );
}

// ── Priced Bill of Quantities ──────────────────────────
function Boq({ doc, prefs, setRate, sheetOf }: { doc: TakeoffDoc; prefs: Prefs; setRate: (r: number) => void; sheetOf: (m: Measurement) => SheetMeta | undefined }) {
  const { units, currency, zmwPerUsd } = prefs;
  const cats = doc.categories.filter((c) => doc.measurements.some((m) => m.category === c));
  let grand = 0;
  return (
    <div>
      <div className="boq-head">
        <label className="field inline">
          <span>1 USD =</span>
          <input type="number" min="0.0001" step="any" defaultValue={zmwPerUsd} key={zmwPerUsd} onBlur={(e) => Number(e.target.value) > 0 && setRate(Number(e.target.value))} />
          <span>ZMW</span>
        </label>
        <span className="muted small">Showing {currency}, {units}</span>
      </div>
      {!doc.measurements.length ? (
        <p className="muted small">Priced quantities appear here. Add unit rates in the Measurements tab.</p>
      ) : (
        <div className="table-wrap">
          <table className="boq">
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Unit</th><th>Waste</th><th>Rate</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {cats.map((c) => {
                let sub = 0;
                const rows = doc.measurements.filter((m) => m.category === c).map((m) => {
                  const q = qty(m, sheetOf(m), units);
                  const withWaste = q == null ? null : q * (1 + m.wastePct / 100);
                  const rate = rateToDisplayUnit(m.rateUsd, m.type, units); // USD per display unit
                  const amountUsd = withWaste == null ? 0 : withWaste * rate;
                  sub += amountUsd;
                  return (
                    <tr key={m.id}>
                      <td>{m.name}{m.description && <div className="muted small">{m.description}</div>}</td>
                      <td className="c-num">{withWaste == null ? '—' : fmt(withWaste)}</td>
                      <td>{unitFor(m, units)}</td>
                      <td className="c-num">{m.wastePct}%</td>
                      <td className="c-num">{money(rate, currency, zmwPerUsd)}</td>
                      <td className="c-num">{money(amountUsd, currency, zmwPerUsd)}</td>
                    </tr>
                  );
                });
                grand += sub;
                return (
                  <CatBlock key={c} title={c} cols={6}>
                    {rows}
                    <tr className="sub-row"><td colSpan={5}>Subtotal — {c}</td><td className="c-num">{money(sub, currency, zmwPerUsd)}</td></tr>
                  </CatBlock>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={5}>PROJECT TOTAL</td><td className="c-num">{money(grand, currency, zmwPerUsd)}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
