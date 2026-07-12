import { describe, expect, it } from "vitest";

import * as m from "@/paraglide/messages";
import { InertTemplateError } from "@/services/template/errors";

import { updateNoteToast } from "./update-single";

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
