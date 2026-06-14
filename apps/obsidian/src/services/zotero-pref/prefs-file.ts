import { regex } from "arkregex";
import { homedir } from "node:os";
import { join } from "node:path";

/** JSON primitives a `user_pref(...)` value can take. */
export type PrefValue = string | number | boolean;

/** Branch every Zotero pref is stored under in `prefs.js`. */
export const PREF_BRANCH = "extensions.zotero.";

/** File Gecko persists user prefs to, inside the profile directory. */
export const PREFS_FILENAME = "prefs.js";

/** File that lists profiles, in the directory above `Profiles/`. */
export const PROFILES_INI_FILENAME = "profiles.ini";

/**
 * Platform directory that holds {@link PROFILES_INI_FILENAME} and the
 * `Profiles/` folder. Relative `Path=` entries in `profiles.ini` are resolved
 * against it.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/profile.js#L88-L90
 */
export function getZoteroProfilesRoot(): string {
  switch (process.platform) {
    case "win32":
      return join(
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "Zotero",
        "Zotero",
      );
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Zotero");
    default:
      return join(homedir(), ".zotero", "zotero");
  }
}

export interface ProfileEntry {
  /**
   * `Path` from the chosen section; relative to the profiles root when
   * {@link isRelative}, otherwise absolute.
   */
  path: string;
  isRelative: boolean;
}

/**
 * Pick the default profile from a `profiles.ini`. Based on Zotero's own "cheap
 * and dirty" parser, but the no-`Default=1` fallback selects the last section
 * that declares a `Path` (a real `[ProfileN]` entry) rather than the last
 * section seen — Zotero writes `[General]` last, which has no `Path`, so the
 * literal "last section" fallback would always fail for a single-profile
 * `profiles.ini` that omits `Default=1`.
 *
 * @returns the default profile entry, or `null` when no section has a `Path`.
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/profile.js#L32-L70
 */
export function parseProfilesIni(content: string): ProfileEntry | null {
  let curSection: Record<string, string> | null = null;
  let defaultSection: Record<string, string> | null = null;
  let lastProfileSection: Record<string, string> | null = null;

  for (const line of content.split(/\r?\n|\r/)) {
    const tline = line.trim();
    if (tline.startsWith("[") && tline.endsWith("]")) {
      curSection = {};
    } else if (curSection && tline !== "") {
      const eq = tline.indexOf("=");
      if (eq === -1) continue;
      const key = tline.slice(0, eq);
      const value = tline.slice(eq + 1);
      curSection[key] = value;
      if (key === "Default" && value === "1") defaultSection = curSection;
      if (key === "Path") lastProfileSection = curSection;
    }
  }
  const chosen = defaultSection ?? lastProfileSection;

  if (!chosen?.Path) return null;
  return {
    path: chosen.Path,
    isRelative: chosen.IsRelative === "1",
  };
}

/**
 * Resolve a {@link ProfileEntry} to an absolute profile directory against the
 * given profiles root.
 */
export function resolveProfileDir(root: string, entry: ProfileEntry): string {
  return entry.isRelative ? join(root, ...entry.path.split("/")) : entry.path;
}

const USER_PREF = regex(
  '^user_pref\\(\\s*(?<key>"(?:[^"\\\\]|\\\\.)*")\\s*,\\s*(?<value>.+)\\)\\s*;\\s*$',
);

/**
 * Parse the `user_pref("name", value);` lines Gecko persists to `prefs.js`
 * into a `fullName → value` map. Lines that aren't a well-formed `user_pref`
 * (comments, the default-pref header, blanks) are skipped, as are values that
 * don't parse as a JSON primitive.
 */
export function parsePrefsJs(content: string): Map<string, PrefValue> {
  const prefs = new Map<string, PrefValue>();
  for (const line of content.split(/\r?\n|\r/)) {
    const match = USER_PREF.exec(line.trim());
    if (!match) continue;
    let key: unknown;
    let value: unknown;
    try {
      key = JSON.parse(match.groups.key);
      value = JSON.parse(match.groups.value.trim());
    } catch {
      continue;
    }
    if (typeof key === "string" && isPrefValue(value)) prefs.set(key, value);
  }
  return prefs;
}

function isPrefValue(value: unknown): value is PrefValue {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}
