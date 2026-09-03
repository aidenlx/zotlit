// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { WorkbenchDocumentController } from "./controller";
import type { WorkbenchSliceId } from "./controller";
import { workbenchSlice } from "./slice";

const PROFILE = `---
id: reading
name: Reading notes
version: 1.0.0
contract: 2
filename: '{{ zt.citationKey }}'
language: liquid
---
# {{ zt.title }}

--- zotlit:annotation ---
> {{ zt.text }}
`;

interface Slice extends Disposable {
  view: EditorView;
  text(): string;
}

function open(
  controller: WorkbenchDocumentController,
  id: WorkbenchSliceId,
): Slice {
  const view = new EditorView({
    state: EditorState.create({
      doc: controller.sliceText(id),
      extensions: [workbenchSlice(controller, id)],
    }),
    parent: document.body,
  });
  return {
    view,
    text: () => view.state.doc.toString(),
    [Symbol.dispose]: () => view.destroy(),
  };
}

describe("workbenchSlice", () => {
  it("opens on the note body alone", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");

    expect(note.text()).toBe("# {{ zt.title }}\n\n");
  });

  it("writes a note edit into the master document", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");

    note.view.dispatch({
      changes: { from: 0, insert: "## Summary\n\n" },
      userEvent: "input.type",
    });

    expect(controller.source).toBe(
      PROFILE.replace("# {{ zt.title }}", "## Summary\n\n# {{ zt.title }}"),
    );
  });

  it("refreshes an open slice when a master undo lands inside it", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");
    note.view.dispatch({
      changes: { from: 0, insert: "## Summary\n\n" },
      userEvent: "input.type",
    });

    controller.undo();

    expect(note.text()).toBe("# {{ zt.title }}\n\n");
    expect(controller.source).toBe(PROFILE);
  });

  it("returns focus to an open slice when a master undo lands inside it", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");
    note.view.dispatch({
      changes: { from: 0, insert: "## Summary\n\n" },
      userEvent: "input.type",
    });
    note.view.contentDOM.blur();

    controller.undo();

    expect(note.view.hasFocus).toBe(true);
  });

  it("replays a form edit inside the focused slice through that slice", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using advanced = open(controller, "advanced");
    controller.setFocusedSlice("advanced");

    expect(controller.setManifestValue(["name"], "Paper notes")).toBe(true);

    expect(controller.source).toBe(
      PROFILE.replace("name: Reading notes", "name: Paper notes"),
    );
    expect(advanced.text()).toBe(controller.source);
  });

  it("adds no undo step when Advanced opens and closes over the same document", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");
    note.view.dispatch({
      changes: { from: 0, insert: "Hello. " },
      userEvent: "input.type",
    });

    {
      using advanced = open(controller, "advanced");
      expect(advanced.text()).toBe(controller.source);
    }

    expect(controller.canUndo).toBe(true);
    controller.undo();
    expect(controller.source).toBe(PROFILE);
    expect(controller.canUndo).toBe(false);
  });

  it("lands a master insertion at the document's edge once", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using advanced = open(controller, "advanced");
    controller.setFocusedSlice("advanced");

    controller.dispatch({
      changes: { from: controller.state.doc.length, insert: "tail\n" },
    });

    expect(controller.source).toBe(`${PROFILE}tail\n`);
    expect(advanced.text()).toBe(controller.source);
  });

  it("lands a master insertion abutting the focused slice once", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");
    controller.setFocusedSlice("note");
    const { from } = controller.sliceRange("note");

    controller.dispatch({ changes: { from: from - 1, insert: "\n# extra" } });

    expect(controller.source).toBe(
      PROFILE.replace("---\n# {{", "---\n# extra\n# {{"),
    );
    expect(note.text()).toBe("# extra\n# {{ zt.title }}\n\n");
  });

  it("lands a master edit straddling the focused slice's boundary once", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");
    controller.setFocusedSlice("note");
    const { from } = controller.sliceRange("note");

    controller.dispatch({ changes: { from: from - 3, to: from + 2 } });

    expect(controller.source).toBe(PROFILE.replace("--\n# {{", "{{"));
    expect(note.text()).toBe("{{ zt.title }}\n\n");
  });

  it("moves a slice's offsets when another slice edits the text before it", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");
    using advanced = open(controller, "advanced");
    const before = controller.sliceRange("note");

    advanced.view.dispatch({
      changes: {
        from: PROFILE.indexOf("id: reading"),
        insert: "# hand-written\n",
      },
      userEvent: "input.type",
    });

    expect(controller.sliceRange("note").from).toBe(
      before.from + "# hand-written\n".length,
    );
    expect(note.text()).toBe("# {{ zt.title }}\n\n");
    expect(controller.source).toContain("# hand-written\nid: reading");
  });

  it("shows the whole document in Advanced and mirrors a note edit into it", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");
    using advanced = open(controller, "advanced");

    expect(advanced.text()).toBe(PROFILE);

    note.view.dispatch({
      changes: { from: 0, insert: "Hello. " },
      userEvent: "input.type",
    });

    expect(advanced.text()).toBe(controller.source);
    expect(advanced.text()).toContain("Hello. # {{ zt.title }}");
  });
});
