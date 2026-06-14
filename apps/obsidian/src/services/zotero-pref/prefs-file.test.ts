import { describe, expect, it } from "vitest";

import { parsePrefsJs, parseProfilesIni } from "./prefs-file";

describe("parseProfilesIni", () => {
  it("picks the section flagged Default=1", () => {
    const ini = [
      "[General]",
      "StartWithLastProfile=1",
      "",
      "[Profile0]",
      "Name=default",
      "IsRelative=1",
      "Path=Profiles/abcd1234.default",
      "",
      "[Profile1]",
      "Name=other",
      "IsRelative=1",
      "Path=Profiles/zzzz9999.other",
      "Default=1",
      "",
    ].join("\n");
    expect(parseProfilesIni(ini)).toEqual({
      path: "Profiles/zzzz9999.other",
      isRelative: true,
    });
  });

  it("falls back to the lone profile when none is Default=1, even with [General] last", () => {
    // Real Zotero ordering: the profile section precedes a trailing [General]
    // (which has no Path). The fallback must pick the profile, not [General].
    const ini = [
      "[Profile0]",
      "Name=default",
      "IsRelative=1",
      "Path=Profiles/only.default",
      "",
      "[General]",
      "StartWithLastProfile=1",
      "Version=2",
    ].join("\r\n");
    expect(parseProfilesIni(ini)).toEqual({
      path: "Profiles/only.default",
      isRelative: true,
    });
  });

  it("reports absolute paths", () => {
    const ini = [
      "[Profile0]",
      "IsRelative=0",
      "Path=/home/me/zotero-profile",
      "Default=1",
    ].join("\n");
    expect(parseProfilesIni(ini)).toEqual({
      path: "/home/me/zotero-profile",
      isRelative: false,
    });
  });

  it("returns null when no section carries a Path", () => {
    expect(parseProfilesIni("[General]\nStartWithLastProfile=1\n")).toBeNull();
    expect(parseProfilesIni("")).toBeNull();
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
