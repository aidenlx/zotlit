import { parse as parseIni } from "@std/ini/parse";
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

/** A `[ProfileN]` entry from `profiles.ini`. */
export interface ZoteroProfile {
  /** `Name` field — the human-readable label for a picker, or `null` when absent. */
  name: string | null;
  /**
   * `Path` from the section; relative to the profiles root when
   * {@link isRelative}, otherwise absolute.
   */
  path: string;
  isRelative: boolean;
  /** Whether the section carried `Default=1`. */
  isDefault: boolean;
}

/**
 * Parse every profile declared in a `profiles.ini`, in file order. A section
 * is a profile when it declares a `Path`; non-profile sections (`[General]`)
 * are skipped. Values stay strings, matching Gecko's INI format.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/profile.js#L45-L70
 */
export function parseZoteroProfiles(content: string): ZoteroProfile[] {
  const ini = parseIni(content);
  const profiles: ZoteroProfile[] = [];
  for (const section of Object.values(ini)) {
    if (typeof section !== "object" || section === null) continue;
    const { Path, Name, IsRelative, Default } = section as Record<
      string,
      unknown
    >;
    if (typeof Path !== "string") continue;
    profiles.push({
      name: typeof Name === "string" ? Name : null,
      path: Path,
      isRelative: IsRelative === "1",
      isDefault: Default === "1",
    });
  }
  return profiles;
}

/**
 * Pick the default profile. The `Default=1` flag wins; otherwise the last
 * profile declared — Zotero writes `[General]` (no `Path`) last, so the last
 * *profile* is the right fallback for a single-profile ini without an explicit
 * default.
 *
 * @returns the default profile, or `undefined` when no profile has a `Path`.
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/profile.js#L59-L70
 */
export function selectDefaultProfile(
  profiles: readonly ZoteroProfile[],
): ZoteroProfile | undefined {
  return profiles.find((p) => p.isDefault) ?? profiles.at(-1);
}

/**
 * Resolve a profile's `Path`/`IsRelative` to an absolute directory against the
 * given profiles root.
 */
export function resolveProfileDir(
  root: string,
  profile: Pick<ZoteroProfile, "path" | "isRelative">,
): string {
  return profile.isRelative
    ? join(root, ...profile.path.split("/"))
    : profile.path;
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
