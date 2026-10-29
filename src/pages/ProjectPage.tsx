import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getProject, patchProjectMeta, projectStore, type ProjectMeta } from '../lib/projects';
import { canSync, pullProjects, pushProject, syncErrorMessage, type SyncState } from '../lib/projectSync';
import ProjectForm from '../components/ProjectForm';

const Workspace = lazy(() => import('../takeoff/Workspace'));

const LABEL: Record<SyncState, string> = {
  local: '● Saved on this device',
  pending: '● Sync pending',
  syncing: '↻ Saving to your account…',
  synced: '✓ Synced to your account',
  error: '⚠ Not synced',
};

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const uid = user!.id;
  const [meta, setMeta] = useState<ProjectMeta | null | undefined>(undefined);
  const [state, setState] = useState<SyncState>('local');
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback(async () => {
    if (!id) return;
    if (!canSync()) {
      setState('pending');
      return;
    }
    setState('syncing');
    try {
      const m = await pushProject(uid, id);
      if (m) setMeta(m);
      setState(m?.dirty ? 'pending' : 'synced');
      setErr('');
    } catch (e) {
      setState('error');
      setErr(syncErrorMessage(e));
    }
  }, [id, uid]);

  const schedule = useCallback(() => {
    setState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(push, 2500);
  }, [push]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      let m = await getProject(uid, id);
      // Opened on a new device via link: try downloading from the account first.
      if (!m && canSync()) {
        try {
          await pullProjects(uid);
          m = await getProject(uid, id);
        } catch (e) {
          setErr(syncErrorMessage(e));
        }
      }
      setMeta(m);
      if (m) {
        setState(m.dirty ? 'pending' : m.syncedAt ? 'synced' : 'local');
        if (m.dirty) push();
      }
    })();
    window.addEventListener('online', push);
    return () => {
      window.removeEventListener('online', push);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id, uid, push]);

  const store = useMemo(() => (id ? projectStore(uid, id, schedule) : null), [id, uid, schedule]);

  if (meta === undefined) return <div className="center-screen"><div className="spinner" /></div>;
  if (!meta || !store) {
    return (
      <div className="page narrow">
        <div className="card empty">
          <h3>Project not found</h3>
          <p className="muted">{err || 'It may have been deleted, or it is not synced to this account yet.'}</p>
          <Link to="/app" className="btn btn-primary">Back to projects</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page wide">
      <div className="project-head">
        <div>
          <Link to="/app" className="small">← Projects</Link>
          <h1>{meta.name}</h1>
          <p className="muted small">
            {[meta.client, meta.siteLocation, meta.projectDate && new Date(meta.projectDate).toLocaleDateString()].filter(Boolean).join(' · ') || 'No details yet'}
            {' · '}
            <button className="linklike" onClick={() => setEditing(true)}>Edit details</button>
          </p>
        </div>
      </div>
      {err && state === 'error' && <div className="banner warn">{err}</div>}

      <Suspense fallback={<div className="center-screen"><div className="spinner" /></div>}>
        <Workspace
          key={meta.id}
          store={store}
          projectName={meta.name}
          status={
            <button className={`sync-badge ${state}`} onClick={push} title={err || 'Tap to sync now'}>
              {LABEL[state]}
            </button>
          }
        />
      </Suspense>

      {editing && (
        <ProjectForm
          title="Edit project"
          submitLabel="Save"
          initial={meta}
          onCancel={() => setEditing(false)}
          onSubmit={async (f) => {
            const m = await patchProjectMeta(uid, meta.id, { ...f, dirty: true, updatedAt: new Date().toISOString() });
            if (m) setMeta(m);
            setEditing(false);
            schedule();
          }}
        />
      )}
    </div>
  );
}
