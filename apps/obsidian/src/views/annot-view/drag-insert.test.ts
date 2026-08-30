// @vitest-environment happy-dom
import { ButtonComponent } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import { ProfileAnnotationError } from "@/services/template/service";

import { createDragInsertHandler } from "./drag-insert";

describe("annotation drag-insert diagnostics", () => {
  it("opens Switch profile for the note whose annotation Profile is unavailable", () => {
    using clicked = vi.spyOn(ButtonComponent.prototype, "onClick");
    using labels = vi.spyOn(ButtonComponent.prototype, "setButtonText");
    const error = new ProfileAnnotationError(
      unknownProfileDiagnostic("Missing (Qw8Er5Ty2Ui9)", {
        path: "Literature/Parent.md",
      }),
    );
    const trigger = vi.fn();
    const notify = vi.fn();
    const handler = createDragInsertHandler({
      app: { workspace: { trigger } } as never,
      noteFeature: {
        renderAnnotation: () => {
          throw error;
        },
      },
      notify,
      getImportHandle: () => ({}) as never,
      onSettled: vi.fn(),
    });
    handler(
      { dataTransfer: { setData: vi.fn() } } as never,
      { itemID: 1, key: "ANNOT1", text: "Excerpt" } as never,
    );
    const message = notify.mock.calls[0]![0] as DocumentFragment;
    expect(message.textContent).toContain("Missing (Qw8Er5Ty2Ui9)");
    expect(labels).toHaveBeenCalledWith(m.profile_switch_recovery());
    clicked.mock.calls[0]![0]({} as MouseEvent);
    expect(trigger).toHaveBeenCalledWith("zotlit:switch-profile", {
      path: "Literature/Parent.md",
    });
  });

  it("shows the Profile recovery, falls back to text, and settles the import handle", () => {
    const error = new ProfileAnnotationError({
      code: "missing-literature-note-template",
      document: "missing.md",
      hint: "Restore the document.",
    });
    const onSettled = vi.fn();
    const notify = vi.fn();
    const data = new Map<string, string>();
    const dataTransfer = {
      dropEffect: "none",
      setData: (type: string, value: string) => data.set(type, value),
    } as unknown as DataTransfer;
    const handler = createDragInsertHandler({
      app: {} as never,
      noteFeature: {
        renderAnnotation: () => {
          throw error;
        },
      },
      notify,
      getImportHandle: () => ({}) as never,
      onSettled,
    });

    handler(
      { dataTransfer } as never,
      { itemID: 1, key: "ANNOT1", text: "Excerpt" } as never,
    );

    expect(notify).toHaveBeenCalledWith(error.message);
    expect(data.get("text/plain")).toBe("Excerpt");
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
