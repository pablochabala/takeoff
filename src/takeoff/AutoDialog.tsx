import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { track } from '../lib/telemetry';
import {
  applyTakeoff,
  prepareSheets,
  readTakeoff,
  readViews,
  toViews,
  type SheetPayload,
  type TakeoffResult,
  type ViewsResult,
} from './autoTakeoff';
import { fmt } from './geometry';
import type { AutoState, AutoView, Measurement, TakeoffDoc } from './types';

type Phase =
  | { k: 'setup' }
  | { k: 'running'; step: 1 | 2; msg: string; started: number }
  | { k: 'views'; views: ViewsResult }
  | { k: 'done'; t: TakeoffResult }
  | { k: 'error'; msg: string; retry: () => void };

export const VIEW_LABEL: Record<AutoView['kind'], string> = {
  plan: 'Plan (overhead)',
  elevation: 'Elevation (front/side)',
  section: 'Section (inside)',
  schedule: 'Schedule',
  detail: 'Detail',
  notes: 'Notes',
  title_block: 'Title block',
};

export default function AutoDialog({
  doc,
  urls,
  loggedIn,
  activeId,
  projectName,
  rerun,
  onViews,
  onApply,
  onClose,
}: {
  doc: TakeoffDoc;
  urls: Map<string, string>;
  loggedIn: boolean;
  activeId: string | null;
  projectName: string;
  /** Re-run with the engineer's answers, reusing the views already found. */
  rerun?: boolean;
  onViews: (views: AutoView[], facts: string[], sheetIds: string[]) => void;
  onApply: (measurements: Measurement[], categories: string[], auto: AutoState, replaceAuto: boolean) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(() =>
    rerun && doc.auto ? doc.auto.sheetIds.filter((id) => doc.sheets.some((s) => s.id === id)) : doc.sheets.slice(0, 8).map((s) => s.id),
  );
  const [phase, setPhase] = useState<Phase>({ k: 'setup' });
  const [replace, setReplace] = useState(true);
  const payload = useRef<SheetPayload[] | null>(null);
  const viewsRef = useRef<ViewsResult | null>(null);
  const hadAuto = doc.measurements.some((m) => m.source === 'auto');
  const answers = (doc.auto?.queries ?? []).filter((q) => q.answer?.trim());

  async function sheets(onStatus: (m: string) => void) {
    if (payload.current) return payload.current;
    const blobs = new Map<string, Blob>();
    for (const id of picked) {
      const u = urls.get(id);
      if (u) blobs.set(id, await (await fetch(u)).blob());
    }
    payload.current = await prepareSheets(doc, blobs, picked, onStatus);
    return payload.current;
  }

  async function stepViews() {
    const started = Date.now();
    const status = (msg: string) => setPhase({ k: 'running', step: 1, msg, started });
    status('Preparing drawings…');
    track('auto_views_started', { sheets: picked.length });
    try {
      const v = await readViews(await sheets(status), projectName, status);
      viewsRef.current = v;
      track('auto_views_result', { result: v, seconds: Math.round((Date.now() - started) / 1000) });
      onViews(toViews(v, picked), v.facts, picked);
      setPhase({ k: 'views', views: v });
    } catch (e) {
      fail(e, stepViews);
    }
  }

  async function stepTakeoff() {
    const started = Date.now();
    const status = (msg: string) => setPhase({ k: 'running', step: 2, msg, started });
    status('Preparing drawings…');
    // On a re-run, rebuild the step-1 view list from what is stored on the project.
    const views =
      viewsRef.current?.views ??
      (doc.auto?.views ?? []).map((v) => ({
        sheet_index: picked.indexOf(v.sheetId) + 1,
        kind: v.kind,
        name: v.name,
        scale_label: v.scaleLabel,
        bbox: v.bbox,
        provides: v.provides,
      })).filter((v) => v.sheet_index > 0);
    track('auto_takeoff_started', { sheets: picked.length, answers: answers.length });
    try {
      const t = await readTakeoff(
        await sheets(status),
        views,
        doc.categories,
        projectName,
        answers.map((a) => ({ id: a.id, question: a.question, answer: a.answer! })),
        status,
      );
      // The raw result (and the engineer's answers) is the most useful accuracy data we have — kept with consent.
      track('auto_takeoff_result', { sheets: picked.length, seconds: Math.round((Date.now() - started) / 1000), answers, result: t });
      setPhase({ k: 'done', t });
    } catch (e) {
      fail(e, stepTakeoff);
    }
  }

  function fail(e: unknown, retry: () => void) {
    const msg = e instanceof Error ? e.message : 'Auto takeoff failed.';
    track('auto_takeoff_failed', { error: msg });
    setPhase({ k: 'error', msg, retry });
  }

  const close = phase.k === 'running' ? undefined : onClose;

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Auto takeoff" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{rerun ? 'Re-run with your answers' : 'Auto takeoff'}</h3>
          {close && <button className="modal-x" onClick={close} aria-label="Close">×</button>}
        </div>

        {!rerun && <Steps phase={phase} />}

        {!loggedIn ? (
          <>
            <p>Auto takeoff finds the plans, elevations and sections on your drawings, then measures the takeoff in the standard order — excavation, mean girth, substructure, walls, floors, doors & windows, finishes, roof.</p>
            <p>It's free, but needs a free account.</p>
            <div className="modal-actions">
              <Link to="/signup" className="btn btn-accent">Create free account</Link>
              <Link to="/login" className="btn btn-secondary">Log in</Link>
            </div>
          </>
        ) : phase.k === 'setup' ? (
          <>
            {rerun ? (
              <p>
                The takeoff will be measured again using your <strong>{answers.length} answer{answers.length === 1 ? '' : 's'}</strong>. Items you drew yourself are kept;
                the previous auto items are replaced.
              </p>
            ) : (
              <p>Choose every sheet the building needs — floor plan, foundation plan, sections, elevations, roof plan and door/window schedule.</p>
            )}
            <div className="sheet-picks">
              {doc.sheets.map((s) => (
                <label key={s.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={picked.includes(s.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, s.id].slice(0, 8) : picked.filter((x) => x !== s.id))}
                  />
                  <span>{s.name}{s.id === activeId ? ' (showing)' : ''}</span>
                </label>
              ))}
            </div>
            <p className="muted small">
              {rerun ? 'Takes about 1–3 minutes.' : 'Two steps, about 2–4 minutes in total.'} Up to 8 sheets. Drawings are sent securely to our AI provider (Anthropic) — see the{' '}
              <Link to="/privacy" target="_blank">Privacy Policy</Link>. Always check results before pricing.
            </p>
            <div className="modal-actions">
              <button className="btn btn-accent" disabled={!picked.length} onClick={rerun ? stepTakeoff : stepViews}>
                {rerun ? 'Re-run takeoff' : 'Step 1: find views'}
              </button>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : phase.k === 'running' ? (
          <div className="auto-running">
            <div className="spinner" />
            <p><strong>{phase.msg}</strong></p>
            <p className="muted small">
              {phase.step === 1 ? 'Telling plans, elevations and sections apart…' : 'Excavation area → mean girth → substructure → walls → floors → doors & windows → finishes → roof…'}{' '}
              Keep this page open. <Elapsed since={phase.started} />
            </p>
          </div>
        ) : phase.k === 'error' ? (
          <>
            <p className="form-error">{phase.msg}</p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={phase.retry}>Try again</button>
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        ) : phase.k === 'views' ? (
          <ViewsReview v={phase.views} sheetNames={picked.map((id) => doc.sheets.find((s) => s.id === id)?.name ?? '')} onNext={stepTakeoff} onCancel={onClose} />
        ) : (
          <TakeoffReview
            t={phase.t}
            hadAuto={hadAuto}
            replace={replace}
            setReplace={setReplace}
            onCancel={onClose}
            onAdd={() => {
              const views = viewsRef.current ? toViews(viewsRef.current, picked) : doc.auto?.views ?? [];
              const facts = viewsRef.current?.facts ?? doc.auto?.facts ?? [];
              const { measurements, categories, auto } = applyTakeoff(phase.t, views, facts, doc, picked, doc.auto?.queries ?? []);
              onApply(measurements, categories, auto, rerun || replace);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Steps({ phase }: { phase: Phase }) {
  const at = phase.k === 'setup' ? 0 : phase.k === 'running' ? phase.step : phase.k === 'views' ? 1.5 : phase.k === 'done' ? 3 : 0;
  const cls = (n: number) => (at > n ? 'done' : at >= n - 0.5 && at <= n ? 'now' : '');
  return (
    <ol className="auto-steps">
      <li className={cls(1)}>1. Find views</li>
      <li className={cls(2)}>2. Measure takeoff</li>
      <li className={cls(3)}>3. Review &amp; queries</li>
    </ol>
  );
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.round((Date.now() - since) / 1000);
  return <span>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

function ViewsReview({ v, sheetNames, onNext, onCancel }: { v: ViewsResult; sheetNames: string[]; onNext: () => void; onCancel: () => void }) {
  const kinds = (k: AutoView['kind']) => v.views.filter((x) => x.kind === k).length;
  return (
    <>
      <p>
        Found <strong>{kinds('plan')} plan</strong>, <strong>{kinds('section')} section</strong> and <strong>{kinds('elevation')} elevation</strong> view
        {v.views.length === 1 ? '' : 's'}, plus {kinds('schedule')} schedule{kinds('schedule') === 1 ? '' : 's'}. They are outlined on the drawing.
      </p>
      <div className="views-list">
        {v.views.map((x, i) => (
          <div key={i} className={`view-row kind-${x.kind}`}>
            <span className="view-kind">{VIEW_LABEL[x.kind]}</span>
            <span className="view-name">
              {x.name} {x.scale_label && <em>· {x.scale_label}</em>}
              <span className="muted small"> — {sheetNames[x.sheet_index - 1] ?? `Sheet ${x.sheet_index}`}</span>
            </span>
            {x.provides && <span className="small muted">{x.provides}</span>}
          </div>
        ))}
      </div>
      {v.facts.length > 0 && (
        <details>
          <summary>Building facts read so far ({v.facts.length})</summary>
          <ul className="small">{v.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </details>
      )}
      <div className="modal-actions">
        <button className="btn btn-accent" onClick={onNext}>Step 2: measure takeoff</button>
        <button className="btn btn-secondary" onClick={onCancel}>Stop here</button>
      </div>
    </>
  );
}

function TakeoffReview({ t, hadAuto, replace, setReplace, onAdd, onCancel }: { t: TakeoffResult; hadAuto: boolean; replace: boolean; setReplace: (b: boolean) => void; onAdd: () => void; onCancel: () => void }) {
  const by = (c: string) => t.items.filter((i) => i.confidence === c).length;
  return (
    <>
      <p>{t.summary}</p>
      <p>
        <strong>{t.items.length} items</strong> · <span className="conf high">{by('high')} clear</span> · <span className="conf medium">{by('medium')} hard to read</span> ·{' '}
        <span className="conf low">{by('low')} estimated</span>
      </p>
      {t.key_figures.length > 0 && (
        <details open>
          <summary>Key figures (waste calculations)</summary>
          <table className="kf-table small">
            <tbody>
              {t.key_figures.map((k, i) => (
                <tr key={i}>
                  <td>{k.label}{k.query_ids?.length ? <span className="q-ref"> ⚠ {k.query_ids.join(', ')}</span> : null}</td>
                  <td className="c-num"><strong>{fmt(k.value)}</strong> {k.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {t.queries.length > 0 && (
        <div className="banner warn small">
          <strong>{t.queries.length} quer{t.queries.length === 1 ? 'y' : 'ies'} for the engineer.</strong> These figures were estimated — answer them in the
          <strong> Queries</strong> tab and re-run for a more accurate takeoff.
        </div>
      )}
      {hadAuto && (
        <label className="check-row">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          <span>Replace the previous auto takeoff items (your own measurements are kept)</span>
        </label>
      )}
      <div className="modal-actions">
        <button className="btn btn-accent" onClick={onAdd}>Add to takeoff</button>
        <button className="btn btn-secondary" onClick={onCancel}>Discard</button>
      </div>
    </>
  );
}
