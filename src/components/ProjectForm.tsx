import { useState, type FormEvent } from 'react';
import type { ProjectMeta } from '../lib/projects';
import '../takeoff/workspace.css';

export type ProjectFields = Pick<ProjectMeta, 'name' | 'client' | 'siteLocation' | 'projectDate'>;

export default function ProjectForm({
  title,
  initial,
  submitLabel,
  note,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: Partial<ProjectFields>;
  submitLabel: string;
  note?: string;
  onSubmit: (f: ProjectFields) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<ProjectFields>({
    name: initial?.name ?? '',
    client: initial?.client ?? '',
    siteLocation: initial?.siteLocation ?? '',
    projectDate: initial?.projectDate ?? new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return;
    setBusy(true);
    await onSubmit({ ...f, name: f.name.trim(), client: f.client.trim(), siteLocation: f.siteLocation.trim() });
    setBusy(false);
  }

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-x" onClick={onCancel} aria-label="Close">×</button>
        </div>
        {note && <p className="muted small">{note}</p>}
        <form className="form" onSubmit={submit}>
          <label>
            Project name
            <input autoFocus required value={f.name} placeholder="e.g. Angolan Consulate — 2 Bedroom House" onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label>
            Client
            <input value={f.client} placeholder="e.g. Angolan Consulate" onChange={(e) => setF({ ...f, client: e.target.value })} />
          </label>
          <label>
            Site location
            <input value={f.siteLocation} placeholder="e.g. Mushitala, Solwezi" onChange={(e) => setF({ ...f, siteLocation: e.target.value })} />
          </label>
          <label>
            Date
            <input type="date" value={f.projectDate} onChange={(e) => setF({ ...f, projectDate: e.target.value })} />
          </label>
          <button className="btn btn-primary" disabled={busy || !f.name.trim()}>{busy ? 'Saving…' : submitLabel}</button>
        </form>
      </div>
    </div>
  );
}
