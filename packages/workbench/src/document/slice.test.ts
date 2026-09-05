// @vitest-environment happy-dom
import { isolateHistory } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { applyTemplateCompletion } from "@/language/completion";
import { templatePairing } from "@/language/pairing";
import { suggestions } from "@/language/suggestions";

import { WorkbenchDocumentController } from "./controller";
import type { WorkbenchSliceId } from "./controller";
import { jsonLayout } from "./json-source";
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
  json = false,
): Slice {
  const view = new EditorView({
    state: EditorState.create({
      doc: json
        ? jsonLayout(controller.sliceText(id), true).text
        : controller.sliceText(id),
      extensions: [
        workbenchSlice(controller, id, json),
        ...(json ? [] : [templatePairing()]),
      ],
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
  it.each(["\n", "\r\n"])(
    "restores generated pairs through master history and pane switches with %j",
    (lineBreak) => {
      const controller = new WorkbenchDocumentController(
        PROFILE.replace("# {{ zt.title }}", "").split("\n").join(lineBreak),
      );
      const type = (view: EditorView, text: string) => {
        const { from, to } = view.state.selection.main;
        const insert = () =>
          view.state.update({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
            userEvent: "input.type",
          });
        if (
          !view.state
            .facet(EditorView.inputHandler)
            .some((handler) => handler(view, from, to, text, insert))
        )
          view.dispatch(insert());
      };
      {
        using note = open(controller, "note");
        type(note.view, "{");
        type(note.view, "{");
        type(note.view, "zt.ti");
        const result = suggestions(note.text(), 8, {
          root: "note",
          partials: [],
        })!;
        applyTemplateCompletion(
          note.view,
          result,
          result.options.find((option) => option.label === "title")!,
        );
        expect(note.text()).toBe("{{ zt.title }}\n");
        expect(note.view.state.selection.main.head).toBe(14);
        controller.undo();
        expect(note.text()).toBe("{{ zt.ti }}\n");
        expect(note.view.state.selection.main.head).toBe(8);
      }
      using reopened = open(controller, "note");
      reopened.view.dispatch({ selection: { anchor: 8 } });
      type(reopened.view, "}");
      type(reopened.view, "}");
      expect(reopened.text()).toBe("{{ zt.ti }}\n");
      expect(reopened.view.state.selection.main.head).toBe(11);
      controller.undo();
      expect(reopened.text()).toBe("\n");
      controller.redo();
      reopened.view.dispatch({ selection: { anchor: 8 } });
      type(reopened.view, "}");
      expect(reopened.text()).toBe("{{ zt.ti }}\n");
      expect(reopened.view.state.selection.main.head).toBe(10);
      expect(controller.source).toBe(
        PROFILE.replace("# {{ zt.title }}", "{{ zt.ti }}")
          .split("\n")
          .join(lineBreak),
      );
    },
  );
  it("keeps undo focus and the other pane's cursor in place", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");
    using annotation = open(controller, "annotation");
    annotation.view.dispatch({ selection: { anchor: 4 } });
    note.view.focus();
    note.view.dispatch({
      changes: { from: 0, insert: "!" },
      selection: { anchor: 1 },
      userEvent: "input.type",
    });
    controller.undo();
    expect(note.text()).toBe("# {{ zt.title }}\n");
    expect(note.view.hasFocus).toBe(true);
    expect(annotation.view.state.selection.main.head).toBe(4);
  });
  it("keeps consecutive accepted completions as separate undo steps", () => {
    const controller = new WorkbenchDocumentController(
      PROFILE.replace("# {{ zt.title }}", "{{ zt.ti }} {{ zt.ke }}"),
    );
    using note = open(controller, "note");
    const accept = (query: string, field: string) => {
      const source = note.text();
      const result = suggestions(source, source.indexOf(query) + query.length, {
        root: "note",
        partials: [],
      })!;
      applyTemplateCompletion(
        note.view,
        result,
        result.options.find((option) => option.label === field)!,
      );
    };
    accept("zt.ti", "title");
    accept("zt.ke", "key");
    expect(note.text()).toBe("{{ zt.title }} {{ zt.key }}\n");
    note.view.dispatch({
      changes: { from: note.view.state.selection.main.head, insert: "!" },
      userEvent: "input.type",
    });
    controller.undo();
    expect(note.text()).toBe("{{ zt.title }} {{ zt.key }}\n");
    controller.undo();
    expect(note.text()).toBe("{{ zt.title }} {{ zt.ke }}\n");
  });
  it.each(["\n", "\r\n"])(
    "isolates note replacement, deletion, and undo with %j line endings",
    (lineBreak) => {
      const source = PROFILE.split("\n").join(lineBreak);
      const controller = new WorkbenchDocumentController(source);
      using note = open(controller, "note");
      using annotation = open(controller, "annotation");
      const prefix = source.slice(0, source.indexOf("# {{ zt.title }}"));
      const suffix = `--- zotlit:annotation ---${lineBreak}> {{ zt.text }}${lineBreak}`;

      for (const text of ["replacement", "", "new last line\nnext line"]) {
        const previous = controller.source;
        note.view.dispatch({
          changes: { from: 0, to: note.view.state.doc.length, insert: text },
        });
        expect(controller.source).toBe(
          prefix + text.split("\n").join(lineBreak) + lineBreak + suffix,
        );
        expect(note.text()).toBe(text);
        expect(annotation.text()).toBe("> {{ zt.text }}\n");
        expect(controller.document).not.toBeNull();
        expect(controller.undo()).toBe(true);
        expect(controller.source).toBe(previous);
        expect(controller.redo()).toBe(true);
        expect(note.text()).toBe(text);
      }
    },
  );

  it.each(["first", "{% managed %}"])(
    "creates the structural boundary for an initially empty note containing %j",
    (text) => {
      const source = PROFILE.replace("# {{ zt.title }}\n\n", "");
      const controller = new WorkbenchDocumentController(source);
      using note = open(controller, "note");
      using annotation = open(controller, "annotation");

      note.view.dispatch({ changes: { from: 0, insert: text } });
      note.view.dispatch({ changes: { from: text.length, insert: " last" } });

      expect(controller.source).toBe(
        source.replace(
          "--- zotlit:annotation ---",
          `${text} last\n--- zotlit:annotation ---`,
        ),
      );
      expect(note.text()).toBe(`${text} last`);
      expect(annotation.text()).toBe("> {{ zt.text }}\n");
      controller.undo();
      expect(controller.source).toBe(source);
      expect(note.text()).toBe("");
      controller.redo();
      expect(note.text()).toBe(`${text} last`);
    },
  );

  it("keeps the annotation separator separate when typing at the note's end", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");
    using annotation = open(controller, "annotation");

    note.view.dispatch({
      changes: {
        from: note.view.state.doc.length,
        insert: "something i type at last",
      },
      userEvent: "input.type",
    });

    expect(controller.source).toContain(
      "something i type at last\n--- zotlit:annotation ---\n> {{ zt.text }}\n",
    );
    expect(annotation.text()).toBe("> {{ zt.text }}\n");
    expect(controller.document).not.toBeNull();
  });

  it("opens on the note body alone", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");

    expect(note.text()).toBe("# {{ zt.title }}\n");
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

    expect(note.text()).toBe("# {{ zt.title }}\n");
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
    expect(note.text()).toBe("# extra\n# {{ zt.title }}\n");
  });

  it("lands a master edit straddling the focused slice's boundary once", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using note = open(controller, "note");
    controller.setFocusedSlice("note");
    const { from } = controller.sliceRange("note");

    controller.dispatch({ changes: { from: from - 3, to: from + 2 } });

    expect(controller.source).toBe(PROFILE.replace("--\n# {{", "{{"));
    expect(note.text()).toBe("{{ zt.title }}\n");
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
    expect(note.text()).toBe("# {{ zt.title }}\n");
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

const JSON_PROFILE = PROFILE.replace(
  "language: liquid",
  'language: liquid\nfrontmatter:\n  - key: title\n    value: {"$eval":"zt.title"}',
);

it("displays pretty JSON, stores compact JSON, and preserves draft-only undo", () => {
  const controller = new WorkbenchDocumentController(JSON_PROFILE);
  using rule = open(controller, "entry:1", true);
  expect(rule.text()).toBe('{\n  "$eval": "zt.title"\n}');
  const original = rule.text();
  rule.view.dispatch({
    changes: { from: 1, insert: "\n" },
    userEvent: "input.type",
  });
  expect(controller.source).toBe(JSON_PROFILE);
  expect(rule.text()).toBe('{\n\n  "$eval": "zt.title"\n}');
  controller.undo();
  expect(rule.text()).toBe(original);
  controller.redo();
  expect(rule.text()).toBe('{\n\n  "$eval": "zt.title"\n}');
  rule.view.dispatch({
    changes: {
      from: 0,
      to: rule.text().length,
      insert: '{\n  "$eval": "zt.key"\n}',
    },
    userEvent: "input.paste",
  });
  expect(controller.source).toBe(JSON_PROFILE.replace('zt.title"', 'zt.key"'));
  expect(controller.document).not.toBeNull();
  controller.undo();
  expect(rule.text()).toBe('{\n\n  "$eval": "zt.title"\n}');
});

it("retains invalid JSON drafts and translates master edits into formatted offsets", () => {
  const controller = new WorkbenchDocumentController(JSON_PROFILE);
  using rule = open(controller, "entry:1", true);
  rule.view.focus();
  controller.setFocusedSlice("entry:1");
  const from = controller.source.indexOf("zt.title");
  controller.dispatch({
    changes: { from, to: from + 8, insert: "zt.key" },
    userEvent: "input.form",
  });
  expect(rule.text()).toBe('{\n  "$eval": "zt.key"\n}');
  rule.view.dispatch({
    changes: { from: rule.text().length - 1, to: rule.text().length },
    userEvent: "delete.backward",
    annotations: isolateHistory.of("before"),
  });
  expect(rule.text()).toBe('{\n  "$eval": "zt.key"\n');
  expect(controller.problems.length).toBeGreaterThan(0);
  controller.undo();
  expect(rule.text()).toBe('{\n  "$eval": "zt.key"\n}');
  expect(controller.document).not.toBeNull();
});

it("keeps grouped typing aligned across pretty and compact undo and redo", () => {
  const controller = new WorkbenchDocumentController(JSON_PROFILE);
  using rule = open(controller, "entry:1", true);
  const original = rule.text();
  const at = original.indexOf("zt.title") + 8;
  for (const [index, insert] of ["A", "B"].entries()) {
    rule.view.dispatch({
      changes: { from: at + index, insert },
      selection: { anchor: at + index + 1 },
      userEvent: "input.type",
    });
  }
  expect(rule.text()).toBe(original.replace("zt.title", "zt.titleAB"));
  controller.undo();
  expect(controller.source).toBe(JSON_PROFILE);
  expect(rule.text()).toBe(original);
  controller.redo();
  expect(controller.source).toBe(
    JSON_PROFILE.replace('zt.title"', 'zt.titleAB"'),
  );
  expect(rule.text()).toBe(original.replace("zt.title", "zt.titleAB"));
  expect(rule.view.state.selection.main.head).toBe(at + 2);
});
