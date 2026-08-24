import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ZOTERO_HTTP_PORT,
  parsePrefsJs,
  parseZoteroProfiles,
  resolveZoteroHttpPort,
  resolveProfileDir,
  selectDefaultProfile,
} from "./prefs-file";

describe("resolveZoteroHttpPort", () => {
  it("uses the active profile's configured port", () => {
    expect(resolveZoteroHttpPort(45_678)).toBe(45_678);
  });

  it("uses Zotero's default when the profile has no valid port", () => {
    expect(resolveZoteroHttpPort(undefined)).toBe(DEFAULT_ZOTERO_HTTP_PORT);
    expect(resolveZoteroHttpPort(65_536)).toBe(DEFAULT_ZOTERO_HTTP_PORT);
  });

  it("reports automatic port selection as undiscoverable", () => {
    expect(resolveZoteroHttpPort(-1)).toBeNull();
  });
});

describe("parseZoteroProfiles", () => {
  it("enumerates every profile section in file order, skipping [General]", () => {
    const ini = [
      "[Profile1]",
      "Name=test",
      "IsRelative=1",
      "Path=Profiles/z50scojp.test",
      "",
      "[Profile0]",
      "Name=default",
      "IsRelative=1",
      "Path=Profiles/ovao64yx.default",
      "Default=1",
      "",
      "[General]",
      "StartWithLastProfile=1",
      "Version=2",
    ].join("\n");
    expect(parseZoteroProfiles(ini)).toEqual([
      {
        name: "test",
        path: "Profiles/z50scojp.test",
        isRelative: true,
        isDefault: false,
      },
      {
        name: "default",
        path: "Profiles/ovao64yx.default",
        isRelative: true,
        isDefault: true,
      },
    ]);
  });

  it("reports absolute paths and missing names", () => {
    const ini = ["[Profile0]", "IsRelative=0", "Path=/home/me/zp"].join("\n");
    expect(parseZoteroProfiles(ini)).toEqual([
      { name: null, path: "/home/me/zp", isRelative: false, isDefault: false },
    ]);
  });

  it("returns an empty list when no section carries a Path", () => {
    expect(parseZoteroProfiles("[General]\nStartWithLastProfile=1\n")).toEqual(
      [],
    );
    expect(parseZoteroProfiles("")).toEqual([]);
  });
});

describe("selectDefaultProfile", () => {
  it("picks the section flagged Default=1", () => {
    const profiles = parseZoteroProfiles(
      [
        "[Profile0]",
        "Path=Profiles/abcd1234.default",
        "IsRelative=1",
        "",
        "[Profile1]",
        "Path=Profiles/zzzz9999.other",
        "IsRelative=1",
        "Default=1",
      ].join("\n"),
    );
    expect(selectDefaultProfile(profiles)?.path).toBe(
      "Profiles/zzzz9999.other",
    );
  });

  it("falls back to the last profile when none is Default=1, even with [General] last", () => {
    // Real Zotero ordering: the profile section precedes a trailing [General]
    // (which has no Path). The fallback must pick the profile, not [General].
    const profiles = parseZoteroProfiles(
      [
        "[Profile0]",
        "IsRelative=1",
        "Path=Profiles/only.default",
        "",
        "[General]",
        "StartWithLastProfile=1",
        "Version=2",
      ].join("\r\n"),
    );
    expect(selectDefaultProfile(profiles)?.path).toBe("Profiles/only.default");
  });

  it("returns undefined when there are no profiles", () => {
    expect(selectDefaultProfile([])).toBeUndefined();
  });
});

describe("resolveProfileDir", () => {
  it("joins relative paths against the profiles root", () => {
    expect(
      resolveProfileDir("/root", {
        path: "Profiles/ab.default",
        isRelative: true,
      }),
    ).toBe(join("/root", "Profiles", "ab.default"));
  });

  it("returns absolute paths unchanged", () => {
    expect(
      resolveProfileDir("/root", { path: "/abs/profile", isRelative: false }),
    ).toBe("/abs/profile");
  });
});

describe("parsePrefsJs", () => {
  it("parses string, number, and boolean user_pref values", () => {
    const prefs = parsePrefsJs(
      [
        "// Mozilla User Preferences",
        "",
        'user_pref("extensions.zotero.baseAttachmentPath", "/Users/me/My Attachments");',
        'user_pref("extensions.zotero.lastViewedFolder", 5);',
        'user_pref("extensions.zotero.useDataDir", true);',
      ].join("\n"),
    );
    expect(prefs.get("extensions.zotero.baseAttachmentPath")).toBe(
      "/Users/me/My Attachments",
    );
    expect(prefs.get("extensions.zotero.lastViewedFolder")).toBe(5);
    expect(prefs.get("extensions.zotero.useDataDir")).toBe(true);
  });

  it("unescapes JSON string values", () => {
    const prefs = parsePrefsJs(
      'user_pref("extensions.zotero.dataDir", "C:\\\\Users\\\\me\\\\Zotero");',
    );
    expect(prefs.get("extensions.zotero.dataDir")).toBe(
      "C:\\Users\\me\\Zotero",
    );
  });

  it("keeps the last value of a duplicated key and tolerates a missing trailing newline", () => {
    const prefs = parsePrefsJs(
      'user_pref("k", "first");\nuser_pref("k", "second");',
    );
    expect(prefs.get("k")).toBe("second");
  });

  it("handles a value string containing ');' via greedy matching", () => {
    const prefs = parsePrefsJs(
      'user_pref("extensions.zotero.baseAttachmentPath", "/a/b);c");',
    );
    expect(prefs.get("extensions.zotero.baseAttachmentPath")).toBe("/a/b);c");
  });

  it("skips comments, blank lines, and malformed entries", () => {
    const prefs = parsePrefsJs(
      [
        "# a comment",
        "",
        'pref("default.only", 1);',
        'user_pref("broken", );',
        'user_pref("ok", "value");',
      ].join("\n"),
    );
    expect(prefs.size).toBe(1);
    expect(prefs.get("ok")).toBe("value");
  });
});
