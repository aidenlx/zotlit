// Approved Attachment Roots as device state: the folders the user permitted as
// attachment sources, held in Obsidian's vault-scoped localStorage so a grant
// never syncs to another device and never applies in another vault. Follows the
// Device Override precedent set by the Zotero profile and data directories.

import type { App } from "obsidian";

/** localStorage surface these helpers need — the vault-scoped store. */
export type DeviceStorage = Pick<App, "loadLocalStorage" | "saveLocalStorage">;

const STORAGE_KEY = "zotlit-approved-attachment-folders";

/**
 * The canonical folders approved on this device, in the order they were
 * granted. A record that is not a list of paths reads as no approvals at all:
 * this is a permission, so anything unreadable grants nothing.
 */
export function loadApprovedFolders(app: DeviceStorage): string[] {
  const raw: unknown = app.loadLocalStorage(STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  const folders = raw.filter(
    (entry: unknown): entry is string => typeof entry === "string" && !!entry,
  );
  return [...new Set(folders)];
}

/** Persist `folders`, dropping the record entirely once nothing is approved. */
export function saveApprovedFolders(
  app: DeviceStorage,
  folders: readonly string[],
): void {
  app.saveLocalStorage(STORAGE_KEY, folders.length > 0 ? [...folders] : null);
}
