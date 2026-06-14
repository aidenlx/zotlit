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
  parseProfilesIni,
  PREF_BRANCH,
  PREFS_FILENAME,
  PROFILES_INI_FILENAME,
  resolveProfileDir,
  type PrefValue,
} from "./prefs-file";

const logger = getLogger("zotero-pref");

export interface ZoteroPrefEvents {
  /** Prefs were re-read after the profile dir changed. Re-read if you cache. */
  changed: () => void;
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

  on<K extends keyof ZoteroPrefEvents>(
    event: K,
    cb: ZoteroPrefEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
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

async function detectDefaultProfileDir(): Promise<string> {
  const root = getZoteroProfilesRoot();
  const iniPath = join(root, PROFILES_INI_FILENAME);
  const entry = parseProfilesIni(await readFile(iniPath, "utf8"));
  if (!entry) {
    throw new Error(`No default Zotero profile found in ${iniPath}`);
  }
  return resolveProfileDir(root, entry);
}
