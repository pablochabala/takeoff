import { del, get, set } from 'idb-keyval';
import { DEFAULT_CATEGORIES, uid, type TakeoffDoc } from '../takeoff/types';
import type { WorkspaceStore } from '../takeoff/store';

// Local (device) project storage, namespaced per signed-in user so two people
// sharing a device never see each other's projects.

export type ProjectMeta = {
  id: string;
  name: string;
  client: string;
  siteLocation: string;
  projectDate: string; // yyyy-mm-dd
  createdAt: string;
  updatedAt: string;
  /** Local changes not yet saved to the cloud. */
  dirty: boolean;
  syncedAt: string | null;
  /** Sheet images already uploaded to cloud storage. */
  uploaded: string[];
  sheetCount: number;
  measurementCount: number;
};

const indexKey = (u: string) => `u:${u}:projects`;
const docKey = (u: string, p: string) => `u:${u}:project:${p}:doc`;
const blobKey = (u: string, p: string, s: string) => `u:${u}:project:${p}:blob:${s}`;

export const emptyDoc = (): TakeoffDoc => ({ sheets: [], measurements: [], categories: [...DEFAULT_CATEGORIES] });

export async function listProjects(userId: string): Promise<ProjectMeta[]> {
  const list = (await get<ProjectMeta[]>(indexKey(userId))) ?? [];
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function writeIndex(userId: string, list: ProjectMeta[]) {
  await set(indexKey(userId), list);
}

export async function getProject(userId: string, id: string) {
  return (await listProjects(userId)).find((p) => p.id === id) ?? null;
}

export async function upsertProjectMeta(userId: string, meta: ProjectMeta) {
  const list = await listProjects(userId);
  const i = list.findIndex((p) => p.id === meta.id);
  if (i >= 0) list[i] = meta;
  else list.push(meta);
  await writeIndex(userId, list);
}

export async function patchProjectMeta(userId: string, id: string, patch: Partial<ProjectMeta>) {
  const list = await listProjects(userId);
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch };
  await writeIndex(userId, list);
  return list[i];
}

export async function createProject(
  userId: string,
  fields: Pick<ProjectMeta, 'name' | 'client' | 'siteLocation' | 'projectDate'>,
  initial?: { doc: TakeoffDoc; blobs: Map<string, Blob> },
): Promise<ProjectMeta> {
  const now = new Date().toISOString();
  const doc = initial?.doc ?? emptyDoc();
  const meta: ProjectMeta = {
    id: uid(),
    ...fields,
    createdAt: now,
    updatedAt: now,
    dirty: true,
    syncedAt: null,
    uploaded: [],
    sheetCount: doc.sheets.length,
    measurementCount: doc.measurements.length,
  };
  await set(docKey(userId, meta.id), doc);
  for (const [sheetId, blob] of initial?.blobs ?? []) await set(blobKey(userId, meta.id, sheetId), blob);
  await upsertProjectMeta(userId, meta);
  return meta;
}

export async function deleteProjectLocal(userId: string, id: string) {
  const doc = await get<TakeoffDoc>(docKey(userId, id));
  for (const s of doc?.sheets ?? []) await del(blobKey(userId, id, s.id));
  await del(docKey(userId, id));
  await writeIndex(userId, (await listProjects(userId)).filter((p) => p.id !== id));
}

export async function loadProjectDoc(userId: string, id: string) {
  return (await get<TakeoffDoc>(docKey(userId, id))) ?? null;
}

export async function loadProjectBlob(userId: string, projectId: string, sheetId: string) {
  return (await get<Blob>(blobKey(userId, projectId, sheetId))) ?? null;
}

/** Write a full doc + blobs pulled from the cloud (not marked dirty). */
export async function storeFromCloud(userId: string, meta: ProjectMeta, doc: TakeoffDoc, blobs: Map<string, Blob>) {
  await set(docKey(userId, meta.id), doc);
  for (const [sheetId, blob] of blobs) await set(blobKey(userId, meta.id, sheetId), blob);
  await upsertProjectMeta(userId, meta);
}

/** Workspace storage adapter for one project. `onChange` fires after each local save. */
export function projectStore(userId: string, projectId: string, onChange: () => void): WorkspaceStore {
  let first = true;
  return {
    async load() {
      const doc = await loadProjectDoc(userId, projectId);
      if (!doc) return null;
      const blobs = new Map<string, Blob>();
      for (const s of doc.sheets) {
        const b = await loadProjectBlob(userId, projectId, s.id);
        if (b) blobs.set(s.id, b);
      }
      return { doc, blobs };
    },
    async saveDoc(doc) {
      // The workspace saves once right after loading; that isn't a user change.
      const prev = await loadProjectDoc(userId, projectId);
      await set(docKey(userId, projectId), doc);
      if (first && prev && JSON.stringify(prev) === JSON.stringify(doc)) {
        first = false;
        return;
      }
      first = false;
      await patchProjectMeta(userId, projectId, {
        updatedAt: new Date().toISOString(),
        dirty: true,
        sheetCount: doc.sheets.length,
        measurementCount: doc.measurements.length,
      });
      onChange();
    },
    async saveBlob(sheetId, blob) {
      await set(blobKey(userId, projectId, sheetId), blob);
    },
  };
}
