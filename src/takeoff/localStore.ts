import { del, get, set } from 'idb-keyval';
import type { TakeoffDoc } from './types';

// Guest work lives only on this device (IndexedDB) until the user signs up.
const DOC_KEY = 'guest:doc';
const blobKey = (id: string) => `guest:blob:${id}`;

export async function loadGuest(): Promise<{ doc: TakeoffDoc; blobs: Map<string, Blob> } | null> {
  try {
    const doc = await get<TakeoffDoc>(DOC_KEY);
    if (!doc || !doc.sheets.length) return null;
    const blobs = new Map<string, Blob>();
    for (const s of doc.sheets) {
      const b = await get<Blob>(blobKey(s.id));
      if (b) blobs.set(s.id, b);
    }
    return { doc: { ...doc, sheets: doc.sheets.filter((s) => blobs.has(s.id)) }, blobs };
  } catch {
    return null;
  }
}

export async function saveGuestDoc(doc: TakeoffDoc) {
  try {
    await set(DOC_KEY, doc);
  } catch {
    /* storage unavailable (private mode) — work stays in memory */
  }
}

export async function saveGuestBlob(id: string, blob: Blob) {
  try {
    await set(blobKey(id), blob);
  } catch {
    /* ignore */
  }
}

export async function clearGuest(doc: TakeoffDoc | null) {
  try {
    for (const s of doc?.sheets ?? []) await del(blobKey(s.id));
    await del(DOC_KEY);
  } catch {
    /* ignore */
  }
}
