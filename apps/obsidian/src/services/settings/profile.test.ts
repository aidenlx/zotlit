import type { CachedMetadata, MetadataCache, TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import type { ProfileId } from "@/lib/profile-stamp";

import {
  boundLiteratureNoteProfileId,
  noteProfileSelector,
  profileOf,
  resolveProfile,
} from "./profile";
import { defaults } from "./schema";
import type { Settings } from "./schema";

const BOOKS_ID = "Bk3Qn7XvT2Lp" as ProfileId;
const OTHER_ID = "Rz9Wm4YfH6Kd" as ProfileId;

function settingsWithBooksProfile(): Readonly<Settings> {
  return {
    ...defaults,
    "note.default-profile": {
      ...defaults["note.default-profile"],
      document: "default.md",
      bindings: {
        ...defaults["note.default-profile"].bindings,
        "note.literature-folder": "Literature",
        "note.import-folder": "Imports",
        "citation.references-style": "vault-style",
      },
    },
    "note.profiles": [
      {
        id: BOOKS_ID,
        label: "Books",
        bindings: { "note.literature-folder": "Books" },
      },
    ],
  };
}

function cacheOf(
  frontmatter: Record<string, unknown> | null,
): Pick<MetadataCache, "getFileCache"> {
  return {
    getFileCache: () =>
      frontmatter === null ? null : ({ frontmatter } as CachedMetadata),
  };
}

const FILE = { path: "note.md" } as TFile;

describe("resolveProfile", () => {
  it("resolves the default Profile with no label or stamp", () => {
    const settings = settingsWithBooksProfile();
    const resolved = resolveProfile(settings, DEFAULT_PROFILE);
    expect(resolved.selector).toBe("default");
    expect(resolved.label).toBeUndefined();
    expect(resolved.stamp).toBeUndefined();
    expect(resolved.document).toBe("default.md");
    expect(resolved.bindings).toEqual({
      "note.literature-folder": "Literature",
      "citation.references-style": "vault-style",
      "note.import-folder": "Imports",
      "note.import-colored-highlights": false,
      "note.import-annotations-as-template": false,
    });
  });

  it("overlays a named Profile's sparse bindings over the default and reports its label and stamp", () => {
    const settings = settingsWithBooksProfile();
    const resolved = resolveProfile(settings, BOOKS_ID);
    expect(resolved).toBeDefined();
    expect(resolved!.stamp).toBe("Books (Bk3Qn7XvT2Lp)");
    expect(resolved!.label).toBe("Books");
    expect(resolved!.bindings["note.literature-folder"]).toBe("Books");
    expect(resolved!.bindings["note.import-folder"]).toBe("Imports");
    expect(resolved!.settings["note.literature-folder"]).toBe("Books");
    expect(boundLiteratureNoteProfileId(resolved!.settings)).toBe(BOOKS_ID);
  });

  it("reports citationStyle undefined for a Profile without its own override, even when the default has one", () => {
    const settings = settingsWithBooksProfile();
    const resolved = resolveProfile(settings, BOOKS_ID);
    expect(resolved!.citationStyle).toBeUndefined();
  });

  it("reports an explicit null citationStyle override verbatim", () => {
    const settings: Readonly<Settings> = {
      ...settingsWithBooksProfile(),
      "note.profiles": [
        {
          id: BOOKS_ID,
          label: "Books",
          bindings: { "citation.references-style": null },
        },
      ],
    };
    const resolved = resolveProfile(settings, BOOKS_ID);
    expect(resolved!.citationStyle).toBeNull();
  });

  it("returns undefined for an unknown Profile id", () => {
    const settings = settingsWithBooksProfile();
    expect(resolveProfile(settings, OTHER_ID)).toBeUndefined();
  });
});

describe("profileOf", () => {
  it("resolves the default Profile when the note carries no stamp", () => {
    const settings = settingsWithBooksProfile();
    const result = profileOf(cacheOf({}), settings, FILE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.profile.selector).toBe("default");
    expect(result.profile.stamp).toBeUndefined();
    expect(result.profile.bindings["note.literature-folder"]).toBe(
      "Literature",
    );
  });

  it("resolves a Profile from a full stamp", () => {
    const settings = settingsWithBooksProfile();
    const result = profileOf(
      cacheOf({ "zotlit-profile": "Books (Bk3Qn7XvT2Lp)" }),
      settings,
      FILE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.profile.selector).toBe(BOOKS_ID);
  });

  it("resolves a Profile from a bare id stamp", () => {
    const settings = settingsWithBooksProfile();
    const result = profileOf(
      cacheOf({ "zotlit-profile": "Bk3Qn7XvT2Lp" }),
      settings,
      FILE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.profile.selector).toBe(BOOKS_ID);
  });

  it("resolves through a stale label hint, reporting the Profile's current label", () => {
    const settings = settingsWithBooksProfile();
    const result = profileOf(
      cacheOf({ "zotlit-profile": "Old name (Bk3Qn7XvT2Lp)" }),
      settings,
      FILE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.profile.label).toBe("Books");
  });

  it("resolves through a one-item frontmatter list", () => {
    const settings = settingsWithBooksProfile();
    const result = profileOf(
      cacheOf({ "zotlit-profile": ["Books (Bk3Qn7XvT2Lp)"] }),
      settings,
      FILE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.profile.selector).toBe(BOOKS_ID);
  });

  it("reports the verbatim stamp when its id names no configured Profile", () => {
    const settings = settingsWithBooksProfile();
    const result = profileOf(
      cacheOf({ "zotlit-profile": "Books (Rz9Wm4YfH6Kd)" }),
      settings,
      FILE,
    );
    expect(result).toEqual({
      ok: false,
      stamped: { stamp: "Books (Rz9Wm4YfH6Kd)", id: "Rz9Wm4YfH6Kd" },
    });
  });

  it("never infers membership from a label-only stamp, even when a Profile has that label", () => {
    const settings = settingsWithBooksProfile();
    const result = profileOf(
      cacheOf({ "zotlit-profile": "Books" }),
      settings,
      FILE,
    );
    expect(result).toEqual({
      ok: false,
      stamped: { stamp: "Books", id: undefined },
    });
  });
});

describe("noteProfileSelector", () => {
  it("names the selector of a resolved Profile", () => {
    const settings = settingsWithBooksProfile();
    expect(noteProfileSelector(profileOf(cacheOf({}), settings, FILE))).toBe(
      "default",
    );
    expect(
      noteProfileSelector(
        profileOf(cacheOf({ "zotlit-profile": BOOKS_ID }), settings, FILE),
      ),
    ).toBe("Bk3Qn7XvT2Lp");
  });

  it("keeps a parsed id that no Profile carries, and yields nothing for a label-only stamp", () => {
    const settings = settingsWithBooksProfile();
    expect(
      noteProfileSelector(
        profileOf(
          cacheOf({ "zotlit-profile": "Books (Rz9Wm4YfH6Kd)" }),
          settings,
          FILE,
        ),
      ),
    ).toBe("Rz9Wm4YfH6Kd");
    expect(
      noteProfileSelector(
        profileOf(cacheOf({ "zotlit-profile": "Books" }), settings, FILE),
      ),
    ).toBeUndefined();
  });
});
