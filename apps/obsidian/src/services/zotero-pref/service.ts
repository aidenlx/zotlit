/**
 * `ZoteroPrefService` — reads Zotero's `prefs.js` on init so individual prefs
 * (notably `baseAttachmentPath`, needed to resolve linked-attachment paths)
 * can be read synchronously afterwards.
 *
 * The profile and data directories are **Device Overrides**: machine-specific
 * paths this service owns and persists per vault × device in Obsidian's
 * localStorage (never synced). Unset means auto-detect — the profile from
 * `profiles.ini`, the data directory from `prefs.js`. The service re-reads prefs
 * whenever the profile override changes ({@link setProfileDir}); there is no
 * file watcher (init-only by design). Read failures leave the service
 * `degraded` with an empty pref map rather than rejecting `ready`, mirroring
 * `DatabaseService`.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { sourceIdFromUris } from "@zotlit/protocol";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { ZOTERO_DB_FILENAME } from "@/lib/constants";
import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";

import {
  type DeviceStorage,
  loadZoteroPathOverrides,
  saveZoteroPathOverrides,
} from "./device-paths";
import {
  getZoteroProfilesRoot,
  parsePrefsJs,
  parseZoteroProfiles,
  PREF_BRANCH,
  PREFS_FILENAME,
  PROFILES_INI_FILENAME,
  resolveProfileDir,
  selectDefaultProfile,
  type PrefValue,
  type ZoteroProfile,
} from "./prefs-file";

const logger = getLogger("zotero-pref");

export interface ZoteroPrefEvents {
  /** Prefs were re-read after the profile dir changed. Re-read if you cache. */
  changed: () => void;
  /**
   * The data-dir Device Override changed. Prefs are untouched, but
   * {@link ZoteroPrefService.dataDir}, {@link ZoteroPrefService.databasePath},
   * and {@link ZoteroPrefService.sourceId} now differ.
   */
  "data-dir-changed": () => void;
  /**
   * The resolved Zotero location moved — profile re-read or data-dir override.
   * Fires alongside `changed` / `data-dir-changed` for consumers that care only
   * that {@link ZoteroPrefService.databasePath} / `dataDir` / `sourceId` changed,
   * not which input moved it.
   */
  "resolved-changed": () => void;
}

/** A Zotero profile resolved to its absolute directory, for the settings picker. */
export interface ZoteroProfileInfo {
  /** `Name` from `profiles.ini`, or `null` when the section omits it. */
  name: string | null;
  /** Absolute profile directory (the folder holding `prefs.js`). */
  dir: string;
  /** Whether this is the profile auto-detect resolves to. */
  isDefault: boolean;
}

export interface ZoteroPrefServiceOptions {
  /** Vault-scoped localStorage for the Device Overrides (per vault × device). */
  app: DeviceStorage;
}

export class ZoteroPrefService extends Service<void> {
  readonly #app;
  readonly #emitter = createNanoEvents<ZoteroPrefEvents>();

  #firstSettled = false;
  #prefs: ReadonlyMap<string, PrefValue> = new Map();
  /** The profile dir the active prefs were read from, or last attempted. */
  #resolvedProfileDir: string | null = null;
  #error: Error | null = null;
  /** Device Override for the profile dir; `null` = auto-detect from `profiles.ini`. */
  #profileDirOverride: string | null;
  /** Device Override for the data dir; wins over prefs in {@link dataDir}. */
  #dataDirOverride: string | null;
  /** Discards stale reloads when the profile override changes faster than reads complete. */
  #loadGen = 0;

  readonly ready: Promise<void>;

  constructor(options: ZoteroPrefServiceOptions) {
    super();
    this.#app = options.app;
    const overrides = loadZoteroPathOverrides(this.#app);
    this.#profileDirOverride = overrides.profileDir;
    this.#dataDirOverride = overrides.dataDir;
    this.ready = this.#load();
  }

  get state(): "loading" | "ready" | "degraded" {
    if (!this.#firstSettled) return "loading";
    return this.#error ? "degraded" : "ready";
  }

  /** The profile directory the active prefs were read from, or attempted. */
  get resolvedProfileDir(): string | null {
    return this.#resolvedProfileDir;
  }

  /** The profile-dir Device Override (a chosen path), or `null` for auto-detect. */
  get profileDirOverride(): string | null {
    return this.#profileDirOverride;
  }

  /** The data-dir Device Override (a chosen path), or `null` for auto-detect. */
  get dataDirOverride(): string | null {
    return this.#dataDirOverride;
  }

  /**
   * Read a pref under the `extensions.zotero.` branch by its bare name (e.g.
   * `"baseAttachmentPath"`), matching `Zotero.Prefs.get(name)`.
   * @returns the parsed value, or `undefined` when unset / prefs unavailable.
   */
  get(name: string): PrefValue | undefined {
    return this.#prefs.get(PREF_BRANCH + name);
  }

  /**
   * The user's linked-attachment base directory, or `null` when unset — the
   * runtime value needed to resolve a `LinkedBasePath` from `@zotlit/db`.
   */
  get baseAttachmentPath(): string | null {
    const value = this.get("baseAttachmentPath");
    return typeof value === "string" ? value : null;
  }

  /**
   * The Zotero data directory holding `zotero.sqlite`. The data-dir Device
   * Override wins when set (an advanced escape hatch for a non-default running
   * profile); otherwise resolved from prefs, mirroring Zotero's
   * `DataDirectory.init`: the `dataDir` pref wins when `useDataDir` is set,
   * else the default `$HOME/Zotero`. Falls back to the default while prefs are
   * loading / degraded (empty map), matching a fresh Zotero install.
   *
   * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/dataDirectory.js#L40-L46
   * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/dataDirectory.js#L83-L84
   */
  get dataDir(): string {
    if (this.#dataDirOverride) return this.#dataDirOverride;
    const dataDir = this.get("dataDir");
    if (
      this.get("useDataDir") === true &&
      typeof dataDir === "string" &&
      dataDir
    ) {
      return dataDir;
    }
    return join(homedir(), "Zotero");
  }

  /**
   * Full path to the Zotero SQLite database file for the current active profile.
   */
  get databasePath(): string {
    return join(this.dataDir, ZOTERO_DB_FILENAME);
  }

  /**
   * Stable id for the active Zotero install, hashed from its profile and data
   * directory — the same hash the Zotero companion stamps on every notify
   * event. `LiveUpdateService` discards events whose `sourceId` doesn't match this.
   *
   * `null` while the profile dir is unknown (loading / detection failed), where
   * no incoming event can be meaningfully matched.
   */
  get sourceId(): string | null {
    if (!this.#resolvedProfileDir) return null;
    return sourceIdFromUris(
      pathToFileURL(this.#resolvedProfileDir).href,
      pathToFileURL(this.dataDir).href,
    );
  }

  on<K extends keyof ZoteroPrefEvents>(
    event: K,
    cb: ZoteroPrefEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /**
   * Set (or clear, with `null`) the profile-dir Device Override. Persists to
   * device storage and re-reads prefs from the new profile, emitting `changed`.
   * No-op when unchanged.
   */
  setProfileDir(dir: string | null): void {
    if (dir === this.#profileDirOverride) return;
    this.#profileDirOverride = dir;
    this.#persistOverrides();
    logger.debug("Profile dir override changed; re-reading prefs", { dir });
    void this.#reload(dir).then(() => {
      this.#emitter.emit("changed");
      this.#emitter.emit("resolved-changed");
    });
  }

  /**
   * Set (or clear, with `null`) the data-dir Device Override. Persists to device
   * storage and emits `data-dir-changed`; prefs are untouched. No-op when
   * unchanged.
   */
  setDataDir(dir: string | null): void {
    if (dir === this.#dataDirOverride) return;
    this.#dataDirOverride = dir;
    this.#persistOverrides();
    logger.debug("Data dir override changed", { dir });
    this.#emitter.emit("data-dir-changed");
    this.#emitter.emit("resolved-changed");
  }

  #persistOverrides(): void {
    saveZoteroPathOverrides(this.#app, {
      profileDir: this.#profileDirOverride,
      dataDir: this.#dataDirOverride,
    });
  }

  /**
   * Enumerate the profiles declared in `profiles.ini`, each resolved to its
   * absolute directory, for the settings profile picker.
   *
   * @returns the profiles in file order, or an empty array when `profiles.ini`
   * is missing or unreadable.
   */
  async listProfiles(): Promise<ZoteroProfileInfo[]> {
    try {
      const { root, profiles } = await readZoteroProfiles();
      return profiles.map((p) => ({
        name: p.name,
        dir: resolveProfileDir(root, p),
        isDefault: p.isDefault,
      }));
    } catch (error) {
      logger.warn("Failed to list Zotero profiles", { error });
      return [];
    }
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#reload(this.#profileDirOverride);
    this.#firstSettled = true;
    this.commit(stack.move());
  }

  async #reload(overrideDir: string | null): Promise<void> {
    const gen = ++this.#loadGen;
    // Tracked outside the try so a prefs.js read failure still surfaces the
    // auto-detected dir it failed on, not just the (null) override value.
    let profileDir = overrideDir;
    try {
      profileDir = overrideDir ?? (await detectDefaultProfileDir());
      const prefs = parsePrefsJs(
        await readFile(join(profileDir, PREFS_FILENAME), "utf8"),
      );
      if (gen !== this.#loadGen) return;
      this.#prefs = prefs;
      this.#resolvedProfileDir = profileDir;
      this.#error = null;
      logger.debug("Loaded Zotero prefs", { profileDir, count: prefs.size });
    } catch (error) {
      if (gen !== this.#loadGen) return;
      this.#prefs = new Map();
      this.#resolvedProfileDir = profileDir;
      this.#error = error instanceof Error ? error : new Error(String(error));
      logger.warn("Failed to read Zotero prefs", { error, profileDir });
    }
  }
}

/** Read and parse `profiles.ini`, returning the profiles root alongside them. */
async function readZoteroProfiles(): Promise<{
  root: string;
  profiles: ZoteroProfile[];
}> {
  const root = getZoteroProfilesRoot();
  const profiles = parseZoteroProfiles(
    await readFile(join(root, PROFILES_INI_FILENAME), "utf8"),
  );
  return { root, profiles };
}

async function detectDefaultProfileDir(): Promise<string> {
  const { root, profiles } = await readZoteroProfiles();
  const profile = selectDefaultProfile(profiles);
  if (!profile) {
    const iniPath = join(root, PROFILES_INI_FILENAME);
    throw new Error(`No default Zotero profile found in ${iniPath}`);
  }
  return resolveProfileDir(root, profile);
}
