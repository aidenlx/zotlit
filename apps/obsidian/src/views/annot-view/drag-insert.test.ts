import { describe, expect, it, vi } from "vitest";

import { ProfileAnnotationError } from "@/services/template/service";

import { createDragInsertHandler } from "./drag-insert";

describe("annotation drag-insert diagnostics", () => {
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
      workspace: {} as never,
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
