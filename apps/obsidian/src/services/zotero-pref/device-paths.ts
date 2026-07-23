// Per-device Zotero profile/data-directory overrides, stored in Obsidian's vault-scoped localStorage (never synced).
import { type App } from "obsidian";

/** localStorage surface these helpers need — the vault-scoped store. */
export type DeviceStorage = Pick<App, "loadLocalStorage" | "saveLocalStorage">;

const STORAGE_KEY = "zotlit-zotero-paths";

/**
 * A device's Zotero path overrides. `null` for either means "auto-detect" — the
 * happy path on a default install. These are machine-specific absolute paths, so
 * they live per vault × device and never sync.
 */
export interface ZoteroPathOverrides {
  profileDir: string | null;
  dataDir: string | null;
}

export function loadZoteroPathOverrides(
  app: DeviceStorage,
): ZoteroPathOverrides {
  const raw: unknown = app.loadLocalStorage(STORAGE_KEY);
  return {
    profileDir: readPath(raw, "profileDir"),
    dataDir: readPath(raw, "dataDir"),
  };
}

/** Persist the overrides as a sparse record, clearing the entry when both are unset. */
export function saveZoteroPathOverrides(
  app: DeviceStorage,
  overrides: ZoteroPathOverrides,
): void {
  const record: Record<string, string> = {};
  if (overrides.profileDir) record.profileDir = overrides.profileDir;
  if (overrides.dataDir) record.dataDir = overrides.dataDir;
  app.saveLocalStorage(
    STORAGE_KEY,
    Object.keys(record).length > 0 ? record : null,
  );
}

function readPath(raw: unknown, key: keyof ZoteroPathOverrides): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}
