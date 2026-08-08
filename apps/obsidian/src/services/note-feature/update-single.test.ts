import { describe, expect, it } from "vitest";

import type { ItemRef } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { InertTemplateError } from "@/services/template/errors";

import { updateNote, updateNoteToast } from "./update-single";
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
      updateNote(noteLessDeps(), REF, "metadata"),
    ).resolves.toBeUndefined();
  });

  it("still creates when the full scope finds no literature note", async () => {
    await expect(updateNote(noteLessDeps(), REF, "full")).rejects.toThrow(
      "create path reached",
    );
  });
});

describe("updateNoteToast", () => {
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
