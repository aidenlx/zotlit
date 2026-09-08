import { describe, expect, it, vi } from "vitest";

import { externalEdit, WorkbenchDocumentController } from "./controller";

const SOURCE = `---
id: paper
name: Paper
version: 1.0.0
contract: 2
language: liquid
filename: paper
---
A stable note body.
--- zotlit:annotation ---
An annotation.
`;

describe("external Profile source", () => {
  it("applies separated edits in one update and preserves an unchanged focused range", () => {
    const controller = new WorkbenchDocumentController(SOURCE);
    const replay = vi.fn<() => void>();
    controller.registerSlice("note", { replay });
    controller.setFocusedSlice("note");
    const caret = SOURCE.indexOf("stable") + 3;
    const updates: number[] = [];
    controller.subscribe(({ transaction }) => {
      expect(transaction.annotation(externalEdit)).toBe(true);
      updates.push(transaction.changes.mapPos(caret));
    });
    controller.applyExternalSource(
      SOURCE.replace("name: Paper", "name: Reading paper").replace(
        "An annotation.",
        "A changed annotation.",
      ),
    );
    expect(updates).toEqual([caret + 8]);
    expect(controller.sliceText("note")).toBe("A stable note body.");
    expect(replay).not.toHaveBeenCalled();
  });

  it("keeps local form history on both sides of the disk update", () => {
    const controller = new WorkbenchDocumentController(SOURCE);
    controller.setManifestKey("name", "Local");
    const local = controller.source;
    controller.applyExternalSource(
      local.replace("A stable note body.", "External text."),
    );
    const external = controller.source;
    controller.setManifestKey("name", "Later");
    expect(controller.undo()).toBe(true);
    expect(controller.source).toBe(external);
    expect(controller.undo()).toBe(true);
    expect(controller.source).toBe(local);
    expect(controller.undo()).toBe(true);
    expect(controller.source).toBe(SOURCE);
  });

  it("saves invalid disk text and restores it with redo", () => {
    const controller = new WorkbenchDocumentController(SOURCE);
    controller.applyExternalSource("---\nname: [unfinished");
    expect(controller.source).toBe("---\nname: [unfinished");
    expect(controller.document).toBeNull();
    controller.undo();
    expect(controller.source).toBe(SOURCE);
    controller.redo();
    expect(controller.source).toBe("---\nname: [unfinished");
  });

  it("does not add a history step when disk bytes are already current", () => {
    const controller = new WorkbenchDocumentController(SOURCE);
    const update = vi.fn<() => void>();
    controller.subscribe(update);
    controller.applyExternalSource(SOURCE);
    expect(update).not.toHaveBeenCalled();
    expect(controller.canUndo).toBe(false);
  });

  it("accepts Eta in the native runtime while retaining web diagnostics", () => {
    const source = SOURCE.replace("language: liquid", "language: eta");
    expect(
      new WorkbenchDocumentController(source, { runtime: "native" }).problems,
    ).toEqual([]);
    expect(
      new WorkbenchDocumentController(source).problems.map(
        (problem) => problem.code,
      ),
    ).toContain("unsupported-language");
  });
});

it("shares annotation insertion and section repair between authoring hosts", () => {
  const source = SOURCE.slice(0, SOURCE.indexOf("--- zotlit:annotation ---"));
  const controller = new WorkbenchDocumentController(source);
  const result = controller.insertAnnotationLoop();
  expect(result.repaired).toBe(true);
  expect(controller.sliceText("note")).toContain(
    "{% for annotation in zt.annotations %}\n{% render_annotation annotation %}\n{% endfor %}\n",
  );
  expect(controller.annotationSection).not.toBeNull();
  expect(controller.problems).toEqual([]);
});
