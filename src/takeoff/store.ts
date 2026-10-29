import { clearGuest, loadGuest, saveGuestBlob, saveGuestDoc } from './localStore';
import type { TakeoffDoc } from './types';

/** Where a workspace keeps its drawings and measurements (guest scratchpad or a project). */
export type WorkspaceStore = {
  load: () => Promise<{ doc: TakeoffDoc; blobs: Map<string, Blob> } | null>;
  saveDoc: (doc: TakeoffDoc) => Promise<void>;
  saveBlob: (sheetId: string, blob: Blob) => Promise<void>;
  /** Present only where "Start over" makes sense (guest mode). */
  clear?: (doc: TakeoffDoc) => Promise<void>;
};

export const guestStore: WorkspaceStore = {
  load: loadGuest,
  saveDoc: saveGuestDoc,
  saveBlob: saveGuestBlob,
  clear: (doc) => clearGuest(doc),
};
