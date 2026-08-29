import { describe, expect, it } from "vitest";

import type { ItemRef } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { InertTemplateError } from "@/services/template/errors";

import {
  duplicateLiteratureNoteWarning,
  updateNote,
  updateNoteToast,
} from "./update-single";
import type { SingleUpdateDeps } from "./update-single";

const REF: ItemRef = {
  itemID: 1,
  libraryID: 1,
  key: "ABCD1234",
  groupID: null,
  indexedKey: "ABCD1234",
};

/**
 * Deps whose every create-path member throws, so reaching the create branch
 * fails the test by name instead of silently succeeding against a stub.
 */
function noteLessDeps(): SingleUpdateDeps {
  return {
    app: {} as SingleUpdateDeps["app"],
    db: {
      get client(): never {
        throw new Error("create path reached: db.client read");
      },
    } as unknown as SingleUpdateDeps["db"],
    settings: {} as SingleUpdateDeps["settings"],
    libraryScope: {
      resolveWith: () => {
        throw new Error("create path reached: library scope resolved");
      },
    },
    noteFeature: {
      createNote: () => {
        throw new Error("create path reached: createNote called");
      },
    } as unknown as SingleUpdateDeps["noteFeature"],
    noteIndex: {
      getNotesByItemKey: () => [],
    } as unknown as SingleUpdateDeps["noteIndex"],
  };
}

describe("updateNote", () => {
  it("never creates when the metadata scope finds no literature note", async () => {
    await expect(
      updateNote(noteLessDeps(), REF, { scope: "metadata" }),
    ).resolves.toBeUndefined();
  });

  it("still creates when the full scope finds no literature note", async () => {
    await expect(
      updateNote(noteLessDeps(), REF, { scope: "full" }),
    ).rejects.toThrow("create path reached");
  });
});

describe("updateNoteToast", () => {
  it("surfaces a Profile refusal for a metadata-only update", () => {
    const { success } = updateNoteToast("metadata");

    expect(
      success({
        bodyUpdated: false,
        duplicateRegionCount: 0,
        diagnostic: {
          code: "unknown-literature-note-profile",
          hint: "Re-stamp the note or recreate the Profile with the same ID.",
          stamp: "Reading notes (Bk3Qn7XvT2Lp)",
        },
      }),
    ).toBe(
      "This literature note uses an unknown profile: Reading notes (Bk3Qn7XvT2Lp). Re-stamp the note or recreate the profile with the same ID.",
    );
  });

  it("names a missing Profile document and its recovery", () => {
    const { success } = updateNoteToast("full");

    expect(
      success({
        bodyUpdated: false,
        duplicateRegionCount: 0,
        diagnostic: {
          code: "missing-literature-note-template",
          hint: "Restore the file.",
          document: "books.md",
        },
      }),
    ).toBe(
      "The profile document books.md is missing. Restore it in the template folder or clear the profile document reference.",
    );
  });

  it("reports a static Profile document separately from a missing Managed Region", () => {
    const { success } = updateNoteToast("full");

    expect(
      success({
        bodyUpdated: false,
        duplicateRegionCount: 0,
        noManagedBlock: true,
      }),
    ).toBe(
      "Frontmatter updated. The profile document has no managed block, so the note body stayed unchanged.",
    );
  });

  it("reports every Managed Frontmatter failure and recovery action", () => {
    const { success } = updateNoteToast("full");

    expect(
      success({
        bodyUpdated: false,
        duplicateRegionCount: 0,
        diagnostic: {
          code: "managed-frontmatter-refused",
          hint: "Correct the named fields, then try again.",
          failures: [
            {
              field: "tags",
              message: "Managed Frontmatter field 'tags' failed to evaluate.",
              hint: "Correct 'tags' in the template document.",
            },
            {
              field: "creators",
              message:
                "Managed Frontmatter field 'creators' requires JavaScript Templates.",
              hint: "Enable JavaScript Templates on this device.",
            },
          ],
        },
      }),
    ).toBe(
      "ZotLit kept the existing Managed Frontmatter. Managed Frontmatter field 'tags' failed to evaluate. Correct 'tags' in the template document. Managed Frontmatter field 'creators' requires JavaScript Templates. Enable JavaScript Templates on this device.",
    );
  });

  it.each(["full", "metadata"] as const)(
    "surfaces an InertTemplateError's own message for the %s scope",
    (scope) => {
      const { error } = updateNoteToast(scope);
      expect(error("msg", new InertTemplateError("Inert message"))).toBe(
        "Inert message",
      );
    },
  );

  it.each(["full", "metadata"] as const)(
    "falls back to the generic failure copy for an untyped error in the %s scope",
    (scope) => {
      const { error } = updateNoteToast(scope);
      expect(error("msg", new Error("boom"))).toBe(
        m.notice_update_note_failed(),
      );
    },
  );
});

describe("duplicateLiteratureNoteWarning", () => {
  it("names every matching note and the note ZotLit selected", () => {
    expect(
      duplicateLiteratureNoteWarning([
        { path: "Literature/Newer.md" },
        { path: "Archive/Older.md" },
      ]),
    ).toBe(
      "Multiple literature notes use this Zotero key: Literature/Newer.md, Archive/Older.md. ZotLit used Literature/Newer.md; resolve the duplicates.",
    );
  });
});
