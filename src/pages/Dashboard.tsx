import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useInstallPrompt } from '../lib/install';
import { createProject, listProjects, patchProjectMeta, type ProjectMeta } from '../lib/projects';
import { canSync, deleteProjectEverywhere, pullProjects, pushAllDirty, syncErrorMessage } from '../lib/projectSync';
import { clearGuest, loadGuest } from '../takeoff/localStore';
import { track } from '../lib/telemetry';
import ProjectForm from '../components/ProjectForm';

export default function Dashboard() {
  const { profile, user } = useAuth();
  const { installed, canPrompt, prompt } = useInstallPrompt();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<null | { mode: 'new' } | { mode: 'import' } | { mode: 'edit'; p: ProjectMeta }>(null);
  const [guestSheets, setGuestSheets] = useState(0);
  const [query, setQuery] = useState('');
  const uid = user!.id;

  const refresh = useCallback(async () => setProjects(await listProjects(uid)), [uid]);

  const sync = useCallback(async () => {
    if (!canSync()) {
      setSyncMsg(navigator.onLine ? '' : 'Offline — showing projects saved on this device.');
      return;
    }
    setSyncing(true);
    setSyncMsg('');
    try {
      await pushAllDirty(uid);
      await pullProjects(uid, setSyncMsg);
      setSyncMsg('');
    } catch (e) {
      setSyncMsg(syncErrorMessage(e));
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [uid, refresh]);

  useEffect(() => {
    refresh().then(sync);
    loadGuest().then((g) => setGuestSheets(g?.doc.sheets.length ?? 0));
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [refresh, sync]);

  const shown = (projects ?? []).filter((p) =>
    `${p.name} ${p.client} ${p.siteLocation}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1>{profile?.full_name ? `${profile.full_name.split(' ')[0]}'s projects` : 'Projects'}</h1>
        <button className="btn btn-accent" onClick={() => setForm({ mode: 'new' })}>+ New project</button>
      </div>

      {(syncMsg || syncing) && <div className="banner info">{syncing && !syncMsg ? 'Syncing with your account…' : syncMsg}</div>}

      {guestSheets > 0 && (
        <div className="card row-between">
          <div>
            <h3>Keep your “Try it now” work</h3>
            <p className="muted">You have {guestSheets} drawing sheet{guestSheets > 1 ? 's' : ''} from the landing page on this device. Save {guestSheets > 1 ? 'them' : 'it'} as a project in your account.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setForm({ mode: 'import' })}>Save as project</button>
        </div>
      )}

      {projects && projects.length > 3 && (
        <input className="search" type="search" placeholder="Search projects, clients, sites…" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}

      {projects === null ? (
        <div className="center-screen"><div className="spinner" /></div>
      ) : projects.length === 0 ? (
        <div className="card empty">
          <h3>No projects yet</h3>
          <p className="muted">Create a project, then upload its drawings (PDF, PNG, JPG or a photo).</p>
          <button className="btn btn-primary" onClick={() => setForm({ mode: 'new' })}>+ New project</button>
        </div>
      ) : (
        <div className="project-grid">
          {shown.map((p) => (
            <div key={p.id} className="project-card">
              <Link to={`/app/p/${p.id}`} className="project-main">
                <h3>{p.name}</h3>
                <p className="muted small">{[p.client, p.siteLocation].filter(Boolean).join(' · ') || '—'}</p>
                <p className="small">
                  {p.sheetCount} sheet{p.sheetCount === 1 ? '' : 's'} · {p.measurementCount} measurement{p.measurementCount === 1 ? '' : 's'}
                  {p.projectDate && <> · {new Date(p.projectDate).toLocaleDateString()}</>}
                </p>
              </Link>
              <div className="project-foot">
                <span className={p.dirty ? 'sync pending' : 'sync ok'}>{p.dirty ? '● Sync pending' : '✓ Synced'}</span>
                <span className="project-actions">
                  <button className="linklike" onClick={() => setForm({ mode: 'edit', p })}>Edit</button>
                  <button
                    className="linklike danger"
                    onClick={async () => {
                      if (!confirm(`Delete “${p.name}” and all its drawings and measurements from all your devices? This cannot be undone.`)) return;
                      try {
                        await deleteProjectEverywhere(uid, p.id);
                        track('project_deleted', { id: p.id });
                      } catch (e) {
                        setSyncMsg(syncErrorMessage(e));
                      }
                      refresh();
                    }}
                  >
                    Delete
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!installed && (
        <div className="card row-between">
          <div>
            <h3>Install TakeoffPro</h3>
            <p className="muted">Add it to your home screen or desktop for quick, offline access.</p>
          </div>
          {canPrompt ? (
            <button className="btn btn-secondary" onClick={prompt}>Install</button>
          ) : (
            <Link to="/install" className="btn btn-secondary">How to install</Link>
          )}
        </div>
      )}

      {form?.mode === 'new' && (
        <ProjectForm
          title="New project"
          submitLabel="Create project"
          onCancel={() => setForm(null)}
          onSubmit={async (f) => {
            const p = await createProject(uid, f);
            track('project_created', { id: p.id });
            navigate(`/app/p/${p.id}`);
          }}
        />
      )}
      {form?.mode === 'import' && (
        <ProjectForm
          title="Save “Try it now” work"
          submitLabel="Save as project"
          note="Your drawings and measurements from the landing page will move into this project."
          onCancel={() => setForm(null)}
          onSubmit={async (f) => {
            const g = await loadGuest();
            if (!g) return setForm(null);
            const p = await createProject(uid, f, g);
            await clearGuest(g.doc);
            track('project_created', { id: p.id, fromGuest: true });
            navigate(`/app/p/${p.id}`);
          }}
        />
      )}
      {form?.mode === 'edit' && (
        <ProjectForm
          title="Edit project"
          submitLabel="Save"
          initial={form.p}
          onCancel={() => setForm(null)}
          onSubmit={async (f) => {
            await patchProjectMeta(uid, form.p.id, { ...f, dirty: true, updatedAt: new Date().toISOString() });
            setForm(null);
            await refresh();
            sync();
          }}
        />
      )}
    </div>
  );
}
