import { supabase, supabaseConfigured } from './supabase';
import {
  deleteProjectLocal,
  listProjects,
  loadProjectBlob,
  loadProjectDoc,
  patchProjectMeta,
  storeFromCloud,
  type ProjectMeta,
} from './projects';
import { DEFAULT_CATEGORIES, type Measurement, type SheetMeta, type TakeoffDoc } from '../takeoff/types';

// Cloud save / load of projects (Stage 2). Simple "last save wins" per project;
// Stage 5 adds device conflict detection with backup copies.

export type SyncState = 'local' | 'pending' | 'syncing' | 'synced' | 'error';

const BUCKET = 'drawings';
const ext = (b: Blob) => (/png/.test(b.type) ? 'png' : 'jpg');
const blobPath = (userId: string, projectId: string, sheetId: string, b: Blob) => `${userId}/${projectId}/${sheetId}.${ext(b)}`;

export function canSync() {
  return supabaseConfigured && navigator.onLine;
}

/** Upload one project (metadata, sheets, measurements, new sheet images). */
export async function pushProject(userId: string, projectId: string): Promise<ProjectMeta | null> {
  const meta = (await listProjects(userId)).find((p) => p.id === projectId);
  const doc = await loadProjectDoc(userId, projectId);
  if (!meta || !doc) return null;
  const startedAt = meta.updatedAt;

  const e1 = await supabase.from('projects').upsert({
    id: meta.id,
    user_id: userId,
    name: meta.name,
    client: meta.client || null,
    site_location: meta.siteLocation || null,
    project_date: meta.projectDate || null,
    settings: { categories: doc.categories },
    updated_at: meta.updatedAt,
    created_at: meta.createdAt,
  });
  if (e1.error) throw e1.error;

  // Sheet images first, so a sheet row never points at a missing file.
  const uploaded = new Set(meta.uploaded);
  const paths: Record<string, string> = {};
  for (const s of doc.sheets) {
    const blob = await loadProjectBlob(userId, projectId, s.id);
    if (!blob) continue;
    paths[s.id] = blobPath(userId, projectId, s.id, blob);
    if (uploaded.has(s.id)) continue;
    const { error } = await supabase.storage.from(BUCKET).upload(paths[s.id], blob, { contentType: blob.type, upsert: true });
    if (error) throw error;
    uploaded.add(s.id);
  }

  if (doc.sheets.length) {
    const { error } = await supabase.from('sheets').upsert(
      doc.sheets.map((s, i) => ({
        id: s.id,
        project_id: projectId,
        user_id: userId,
        name: s.name,
        sort_order: i,
        source_type: s.source,
        storage_path: paths[s.id] ?? null,
        width_px: s.width,
        height_px: s.height,
        scale: { scale: s.scale, pxPerPaperMm: s.pxPerPaperMm },
        regions: s.regions,
        updated_at: meta.updatedAt,
      })),
    );
    if (error) throw error;
  }

  if (doc.measurements.length) {
    const { error } = await supabase.from('measurements').upsert(
      doc.measurements.map((m, i) => ({
        id: m.id,
        sheet_id: m.sheetId,
        project_id: projectId,
        user_id: userId,
        type: m.type,
        name: m.name,
        description: m.description || null,
        category: m.category,
        color: m.color,
        timesing: m.timesing,
        waste_pct: m.wastePct,
        unit_rate: m.rateUsd,
        depth_m: m.depthM,
        geometry: { points: m.points, holes: m.holes },
        sort_order: i,
        updated_at: meta.updatedAt,
      })),
    );
    if (error) throw error;
  }

  // Remove server rows deleted on this device.
  await deleteMissing('measurements', projectId, doc.measurements.map((m) => m.id));
  const removedSheets = await deleteMissing('sheets', projectId, doc.sheets.map((s) => s.id));
  if (removedSheets.length) await supabase.storage.from(BUCKET).remove(removedSheets.filter(Boolean) as string[]);

  // Only clear "dirty" if nothing changed locally while we were uploading.
  const latest = (await listProjects(userId)).find((p) => p.id === projectId);
  return patchProjectMeta(userId, projectId, {
    uploaded: [...uploaded],
    syncedAt: new Date().toISOString(),
    dirty: latest ? latest.updatedAt !== startedAt : false,
  });
}

async function deleteMissing(table: 'sheets' | 'measurements', projectId: string, keep: string[]): Promise<(string | null)[]> {
  let q = supabase.from(table).delete().eq('project_id', projectId);
  if (keep.length) q = q.not('id', 'in', `(${keep.join(',')})`);
  const { data, error } = await q.select(table === 'sheets' ? 'storage_path' : 'id');
  if (error) throw error;
  return table === 'sheets' ? ((data ?? []) as Array<{ storage_path: string | null }>).map((r) => r.storage_path) : [];
}

/** Push every project with unsaved changes. */
export async function pushAllDirty(userId: string) {
  for (const p of await listProjects(userId)) if (p.dirty) await pushProject(userId, p.id);
}

type ProjectRow = {
  id: string;
  name: string;
  client: string | null;
  site_location: string | null;
  project_date: string | null;
  settings: { categories?: string[] } | null;
  updated_at: string;
  created_at: string;
};

/**
 * Download projects that are new or newer on the server (e.g. saved from another
 * device). Local projects with unsaved changes are left alone.
 * Returns ids of projects deleted on the server (removed locally too).
 */
export async function pullProjects(userId: string, onProgress?: (msg: string) => void) {
  const { data, error } = await supabase
    .from('projects')
    .select('id,name,client,site_location,project_date,settings,updated_at,created_at')
    .is('deleted_at', null);
  if (error) throw error;
  const rows = (data ?? []) as ProjectRow[];
  const local = await listProjects(userId);
  const serverIds = new Set(rows.map((r) => r.id));

  // Synced locally before but gone on the server → deleted elsewhere.
  for (const p of local) if (p.syncedAt && !p.dirty && !serverIds.has(p.id)) await deleteProjectLocal(userId, p.id);

  for (const r of rows) {
    const mine = local.find((p) => p.id === r.id);
    if (mine && (mine.dirty || new Date(mine.updatedAt) >= new Date(r.updated_at))) continue;
    onProgress?.(`Downloading “${r.name}”…`);
    await downloadProject(userId, r);
  }
}

async function downloadProject(userId: string, r: ProjectRow) {
  const [sh, me] = await Promise.all([
    supabase.from('sheets').select('*').eq('project_id', r.id).order('sort_order'),
    supabase.from('measurements').select('*').eq('project_id', r.id).order('sort_order'),
  ]);
  if (sh.error) throw sh.error;
  if (me.error) throw me.error;

  const blobs = new Map<string, Blob>();
  const sheets: SheetMeta[] = [];
  for (const s of sh.data ?? []) {
    if (s.storage_path) {
      const { data: b } = await supabase.storage.from(BUCKET).download(s.storage_path);
      if (b) blobs.set(s.id, b);
    }
    sheets.push({
      id: s.id,
      name: s.name,
      source: s.source_type,
      width: s.width_px,
      height: s.height_px,
      pxPerPaperMm: s.scale?.pxPerPaperMm ?? null,
      scale: s.scale?.scale ?? null,
      regions: s.regions ?? [],
    });
  }
  const measurements: Measurement[] = (me.data ?? []).map((m) => ({
    id: m.id,
    sheetId: m.sheet_id,
    type: m.type,
    name: m.name,
    description: m.description ?? '',
    category: m.category,
    color: m.color,
    timesing: Number(m.timesing),
    wastePct: Number(m.waste_pct),
    rateUsd: Number(m.unit_rate),
    depthM: m.depth_m == null ? null : Number(m.depth_m),
    points: m.geometry?.points ?? [],
    holes: m.geometry?.holes ?? [],
  }));
  const doc: TakeoffDoc = { sheets, measurements, categories: r.settings?.categories ?? [...DEFAULT_CATEGORIES] };
  const meta: ProjectMeta = {
    id: r.id,
    name: r.name,
    client: r.client ?? '',
    siteLocation: r.site_location ?? '',
    projectDate: r.project_date ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    dirty: false,
    syncedAt: new Date().toISOString(),
    uploaded: [...blobs.keys()],
    sheetCount: sheets.length,
    measurementCount: measurements.length,
  };
  await storeFromCloud(userId, meta, doc, blobs);
}

/** Delete a project everywhere (cloud rows cascade; storage files removed explicitly). */
export async function deleteProjectEverywhere(userId: string, projectId: string) {
  if (canSync()) {
    const { data: files } = await supabase.storage.from(BUCKET).list(`${userId}/${projectId}`);
    if (files?.length) await supabase.storage.from(BUCKET).remove(files.map((f) => `${userId}/${projectId}/${f.name}`));
    await supabase.from('projects').delete().eq('id', projectId);
  }
  await deleteProjectLocal(userId, projectId);
}

/** Friendly message, with a hint when the database hasn't been set up yet. */
export function syncErrorMessage(e: unknown) {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/schema cache|does not exist|PGRST205|Bucket not found/i.test(msg)) return 'Cloud database not set up yet — run the SQL files in Supabase (see SETUP.md). Your work is safe on this device.';
  if (/JWT|key type|invalid.*token|not authorized|401/i.test(msg)) return 'Your login has expired — log out and log in again to save to your account. Your work is safe on this device.';
  if (/fetch|network/i.test(msg)) return 'Offline — will save to your account when you reconnect.';
  return msg;
}
