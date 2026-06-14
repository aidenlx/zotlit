/**
 * `ZoteroPrefService` — reads Zotero's `prefs.js` on init so individual prefs
 * (notably `baseAttachmentPath`, needed to resolve linked-attachment paths)
 * can be read synchronously afterwards.
 *
 * The profile directory is the `zotero.profile-dir` setting when set, otherwise
 * auto-detected from `profiles.ini`. Prefs are re-read whenever that setting
 * changes; there is no file watcher (init-only by design). Read failures leave
 * the service `degraded` with an empty pref map rather than rejecting `ready`,
 * mirroring `DatabaseService`.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import {
  type Settings,
  type SettingsService,
} from "@/services/settings/service";

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

export const DB_FILENAME = "zotero.sqlite";

export interface ZoteroPrefEvents {
  /** Prefs were re-read after the profile dir changed. Re-read if you cache. */
  changed: () => void;
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
  settings: SettingsService;
}

export class ZoteroPrefService extends Service<void> {
  readonly #settings;
  readonly #emitter = createNanoEvents<ZoteroPrefEvents>();

  #firstSettled = false;
  #prefs: ReadonlyMap<string, PrefValue> = new Map();
  /** The profile dir the active prefs were read from, or last attempted. */
  #resolvedProfileDir: string | null = null;
  #error: Error | null = null;
  /** The `zotero.profile-dir` setting value last applied to a reload. */
  #appliedProfileDir: string | null = null;
  /** Discards stale reloads when settings change faster than reads complete. */
  #loadGen = 0;

  readonly ready: Promise<void>;

  constructor(options: ZoteroPrefServiceOptions) {
    super();
    this.#settings = options.settings;
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
   * The Zotero data directory holding `zotero.sqlite`, resolved from prefs.
   * Mirrors Zotero's `DataDirectory.init`: the `dataDir` pref wins when
   * `useDataDir` is set, otherwise the default `$HOME/Zotero`. Falls back to
   * the default while prefs are loading / degraded (empty map), matching a
   * fresh Zotero install.
   *
   * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/dataDirectory.js#L40-L46
   * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/dataDirectory.js#L83-L84
   */
  get dataDir(): string {
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
    return join(this.dataDir, DB_FILENAME);
  }

  on<K extends keyof ZoteroPrefEvents>(
    event: K,
    cb: ZoteroPrefEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
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

    const snapshot = await this.#settings.loaded;
    this.#appliedProfileDir = snapshot["zotero.profile-dir"];
    await this.#reload(this.#appliedProfileDir);

    stack.defer(
      this.#settings.subscribe((value) => {
        if (value === null) return;
        this.#onSettingsChanged(value);
      }),
    );

    this.#firstSettled = true;
    this.commit(stack.move());
  }

  #onSettingsChanged(s: Readonly<Settings>): void {
    const dir = s["zotero.profile-dir"];
    if (dir === this.#appliedProfileDir) return;
    this.#appliedProfileDir = dir;
    logger.debug("Profile dir changed; re-reading prefs", { dir });
    void this.#reload(dir).then(() => this.#emitter.emit("changed"));
  }

  async #reload(settingDir: string | null): Promise<void> {
    const gen = ++this.#loadGen;
    // Tracked outside the try so a prefs.js read failure still surfaces the
    // auto-detected dir it failed on, not just the (null) setting value.
    let profileDir = settingDir;
    try {
      profileDir = settingDir ?? (await detectDefaultProfileDir());
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
