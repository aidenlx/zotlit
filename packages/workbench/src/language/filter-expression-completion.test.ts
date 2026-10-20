// @vitest-environment happy-dom
import { startCompletion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { ITEMS } from "@zotlit/item-query";

import { filterExpressionLanguage } from "./filter-expression";
import {
  datasetExpressionFields,
  expressionCompletions,
  filterExpressionCompletion,
} from "./filter-expression-completion";
import type { ExpressionVocabulary } from "./filter-expression-completion";

const FILTER: ExpressionVocabulary = {
  fields: [
    { path: "title", label: "Title", type: "string" },
    { path: "itemType", label: "Item type", type: "string" },
    { path: "dateAdded", label: "Date added", type: "date" },
  ],
  context: true,
  formulas: [
    { name: "score", label: "Reading score" },
    { name: "late", label: "formula.late" },
  ],
  vault: [
    { name: "status", label: "status (note)" },
    { name: "reading-status", label: "reading-status (note)" },
  ],
};

/** The labels offered with the caret at the `|` of `marked`. */
function offered(
  marked: string,
  vocabulary: ExpressionVocabulary = FILTER,
  explicit = false,
) {
  const pos = marked.indexOf("|");
  const source = marked.replace("|", "");
  return expressionCompletions(source, pos, { vocabulary, explicit });
}

function labels(...args: Parameters<typeof offered>) {
  return offered(...args)?.options.map((option) => option.label) ?? [];
}

describe("fields", () => {
  it("offers a field by a prefix, with its type and the label the Properties popover gives it", () => {
    const result = offered("tit|")!;
    expect(result.from).toBe(0);
    expect(result.options[0]).toMatchObject({
      label: "title",
      insert: "title",
      type: "string",
      note: "Title",
    });
  });

  it("offers a field by its label too", () => {
    expect(labels("added|")).toContain("dateAdded");
  });

  it("offers fields in call arguments and after an operator", () => {
    expect(offered("max(tit|")).toMatchObject({ from: 4 });
    expect(labels("max(tit|")[0]).toBe("title");
    expect(labels("itemType == 'book' && tit|")[0]).toBe("title");
  });

  it("offers nothing inside a string, a regular expression or a number", () => {
    expect(offered('"tit|')).toBeNull();
    expect(offered("title.matches(/tit|")).toBeNull();
    expect(offered("12|")).toBeNull();
  });

  it("offers nothing on an empty field until asked", () => {
    expect(offered("|")).toBeNull();
    expect(labels("|", FILTER, true)).toEqual(
      expect.arrayContaining(["title", "min", "formula.score"]),
    );
  });
});

describe("namespaces", () => {
  it("offers this.item and this.attachment where the view binds a Query Context", () => {
    expect(labels("th|")).toEqual(
      expect.arrayContaining(["this.item", "this.attachment"]),
    );
    expect(
      labels("th|", { ...FILTER, context: false }).filter((label) =>
        label.startsWith("this"),
      ),
    ).toEqual([]);
  });

  it("offers each Formula Property as formula.<name>, before and after the dot", () => {
    expect(offered("fo|")!.options.slice(0, 2)).toEqual([
      {
        label: "formula.score",
        insert: "formula.score",
        kind: "namespace",
        note: "Reading score",
      },
      // A label that only repeats the name shows no note.
      { label: "formula.late", insert: "formula.late", kind: "namespace" },
    ]);
    const result = offered("formula.s|")!;
    expect(result.from).toBe(0);
    expect(result.options.map((option) => option.label)).toEqual([
      "formula.score",
    ]);
  });

  it("offers vault properties in a filter, by bracket access where the dot cannot reach", () => {
    expect(offered("va|")!.options.slice(0, 2)).toMatchObject([
      { label: "vault.status", insert: "vault.status", note: "status (note)" },
      { label: "vault.reading-status", insert: 'vault["reading-status"]' },
    ]);
  });

  it("offers no vault property in a Formula", () => {
    const formula = { ...FILTER, vault: undefined };
    expect(labels("va|", formula).filter((l) => l.startsWith("vault"))).toEqual(
      [],
    );
    expect(offered("vault.|", formula)).toBeNull();
  });

  it("leaves the members of any other value to the member completion", () => {
    expect(offered("title.|")).toBeNull();
    expect(offered("title.lo|")).toBeNull();
  });
});

describe("functions", () => {
  it("offers a global function with its signature and description", () => {
    expect(offered("mi|")!.options[0]).toEqual({
      label: "min",
      insert: "min()",
      caret: 4,
      kind: "function",
      type: "min(…) → number",
      note: "The smallest number among the arguments, or null when no argument is a number.",
    });
  });

  it("shows a call that takes no argument and a result of any type", () => {
    expect(offered("no|")!.options[0]).toMatchObject({
      label: "now",
      type: "now() → date",
    });
    expect(offered("if|")!.options[0]).toMatchObject({
      label: "if",
      type: "if(…) → any",
    });
  });
});

describe("in the editor", () => {
  function editor(doc: string, vocabulary: ExpressionVocabulary = FILTER) {
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          filterExpressionLanguage,
          filterExpressionCompletion(() => vocabulary),
        ],
      }),
      parent: document.body,
    });
    return {
      view,
      async accept(label: string) {
        startCompletion(view);
        const option = await vi.waitFor(() => {
          const found = [
            ...document.querySelectorAll<HTMLElement>(
              ".cm-tooltip-autocomplete li",
            ),
          ].find(
            (row) =>
              row.querySelector(".cm-completionLabel")?.textContent === label,
          );
          if (!found) throw new Error(`no ${label} yet`);
          return found;
        });
        option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        option.click();
      },
      [Symbol.dispose]: () => view.destroy(),
    };
  }

  it("inserts a function with the caret between its parentheses", async () => {
    using field = editor("title == mi");
    await field.accept("min");
    expect(field.view.state.doc.toString()).toBe("title == min()");
    expect(field.view.state.selection.main.head).toBe(13);
  });

  it("replaces the whole namespace path it was opened on", async () => {
    using field = editor("formula.s");
    await field.accept("formula.score");
    expect(field.view.state.doc.toString()).toBe("formula.score");
  });
});

describe("the fields of a Query Dataset", () => {
  it("lists each name a filter reads, with the type its planner gives and the host's label", () => {
    const fields = datasetExpressionFields(ITEMS, (path) =>
      path === "title" ? "Title" : undefined,
    );
    expect(fields).toContainEqual({
      path: "title",
      label: "Title",
      type: "string",
    });
    expect(fields).toContainEqual({ path: "dateAdded", type: "date" });
    expect(fields).toContainEqual({ path: "creators", type: "list" });
    // `custom` is read only by bracket access to a custom field.
    expect(fields.map((field) => field.path)).not.toContain("custom");
  });
});
