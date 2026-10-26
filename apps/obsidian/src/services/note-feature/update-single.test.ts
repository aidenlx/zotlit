import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { InertTemplateError } from "@/services/template/errors";

import {
  duplicateLiteratureNoteWarning,
  updateNoteToast,
} from "./update-single";

describe("updateNoteToast", () => {
  it("surfaces a Profile refusal for a metadata-only update", () => {
    const { success } = updateNoteToast("metadata");

    expect(
      success({
        bodyUpdated: false,
        duplicateRegionCount: 0,
        diagnostic: {
          code: "unknown-literature-note-profile",
          hint: "Use Switch profile... to choose an available Profile for this note.",
          recovery: { action: "switch-profile" },
          stamp: "Reading notes (Bk3Qn7XvT2Lp)",
        },
      }),
    ).toBe(
      m.notice_literature_note_profile_unknown({
        stamp: "Reading notes (Bk3Qn7XvT2Lp)",
      }),
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
      "Properties updated. The profile document has no managed block, so the note body stayed unchanged.",
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

  it.each(["full"] as const)(
    "surfaces an InertTemplateError's own message for the %s scope",
    (scope) => {
      const { error } = updateNoteToast(scope);
      expect(error("msg", new InertTemplateError("Inert message"))).toBe(
        "Inert message",
      );
    },
  );

  it.each(["full"] as const)(
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
