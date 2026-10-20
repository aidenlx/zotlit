// @vitest-environment happy-dom
import { startCompletion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { ANNOTATIONS, ITEMS } from "@zotlit/item-query";

import { datasetReceiver } from "./expression-receiver";
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
  custom: { path: "custom", names: ["Reading status", "Shelf"] },
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

  it("offers the members of a value after a namespace path", () => {
    expect(labels("formula.score.|", typing({}))).toContain("lower");
  });
});

/** A vocabulary whose receivers are typed by their text, as `types` names them. */
function typing(
  types: Record<
    string,
    ReturnType<NonNullable<ExpressionVocabulary["receiver"]>>
  >,
): ExpressionVocabulary {
  return {
    ...FILTER,
    receiver: (source, { from, to }) => types[source.slice(from, to)],
  };
}

describe("members", () => {
  const typed = typing({
    title: { type: "string" },
    dateAdded: { type: "date" },
    tags: { type: "list" },
  });

  it("offers the methods and properties of a string after title.", () => {
    const result = offered("title.|", typed)!;
    expect(result).toMatchObject({ from: 6, to: 6 });
    const names = result.options.map((option) => option.label);
    expect(names).toEqual(
      expect.arrayContaining(["lower", "slice", "length", "isEmpty"]),
    );
    expect(names).not.toContain("year");
    expect(names).not.toContain("format");
  });

  it("inserts a method with the caret between its parentheses, and a property as its name", () => {
    const options = offered("title.|", typed)!.options;
    expect(options.find((option) => option.label === "lower")).toMatchObject({
      insert: "lower()",
      caret: 6,
      kind: "method",
      type: "lower() → string",
    });
    expect(options.find((option) => option.label === "length")).toMatchObject({
      insert: "length",
      kind: "property",
      type: "number",
    });
  });

  it("offers the members of a date after date. and of a list after tags.", () => {
    expect(labels("dateAdded.|", typed)).toEqual(
      expect.arrayContaining(["year", "format", "relative"]),
    );
    expect(labels("dateAdded.|", typed)).not.toContain("lower");
    expect(labels("tags.|", typed)).toEqual(
      expect.arrayContaining(["filter", "map", "reduce", "contains", "length"]),
    );
  });

  it("offers every method and property of every type after a receiver that does not plan", () => {
    const names = labels("(title +.|", typed);
    expect(names).toEqual(
      expect.arrayContaining(["lower", "year", "format", "filter", "length"]),
    );
    // A name with a definition on several types is one entry.
    expect(names.filter((name) => name === "slice")).toHaveLength(1);
    expect(
      offered("(title +.|", typed)!.options.find((o) => o.label === "slice"),
    ).toMatchObject({ type: "slice(…) → string | list" });
  });

  it("offers every member where the host types no receiver", () => {
    expect(labels("title.|")).toEqual(
      expect.arrayContaining(["lower", "year"]),
    );
  });

  it("matches the typed member name and replaces it whole", () => {
    const result = offered("title.lo|wer", typed)!;
    expect(result).toMatchObject({ from: 6, to: 11 });
    expect(result.options[0]!.label).toBe("lower");
  });
});

describe("bracket keys", () => {
  it("offers the known custom fields quoted inside custom[", () => {
    const result = offered("custom[|", FILTER)!;
    expect(result).toMatchObject({ from: 7, to: 7 });
    expect(result.options).toEqual([
      { label: '"Reading status"', insert: '"Reading status"]', kind: "key" },
      { label: '"Shelf"', insert: '"Shelf"]', kind: "key" },
    ]);
  });

  it("matches the typed key and replaces the whole quoted key", () => {
    const result = offered('custom["she|"]', FILTER)!;
    expect(result).toMatchObject({ from: 7, to: 12 });
    expect(result.options).toEqual([
      { label: '"Shelf"', insert: '"Shelf"', kind: "key" },
    ]);
  });

  it("offers custom keys only at the path the dataset reads custom fields by", () => {
    // An Annotation reads its Item's custom fields.
    const annotations = {
      ...FILTER,
      custom: { path: "item.custom", names: ["Shelf"] },
    };
    expect(labels("item.custom[|", annotations)).toEqual(['"Shelf"']);
    expect(offered("custom[|", annotations)).toBeNull();
    expect(offered("item.custom[|", FILTER)).toBeNull();
  });

  it("offers vault names quoted inside vault[, in filter conditions only", () => {
    expect(labels("vault[|", FILTER)).toEqual(['"status"', '"reading-status"']);
    expect(offered("vault[|", { ...FILTER, vault: undefined })).toBeNull();
  });

  it("leaves another array access to the expression completion", () => {
    expect(labels("tags[ti|", FILTER)[0]).toBe("title");
  });
});

describe("names a list method binds", () => {
  it("offers value and index first inside tags.filter(, as soon as it opens", () => {
    const options = offered("tags.filter(|")!.options;
    expect(options.slice(0, 2)).toEqual([
      { label: "value", insert: "value", kind: "variable" },
      { label: "index", insert: "index", kind: "variable" },
    ]);
    expect(options.map((option) => option.label)).toContain("title");
    expect(labels("tags.map(|").slice(0, 2)).toEqual(["value", "index"]);
  });

  it("offers acc too inside reduce(", () => {
    expect(labels("tags.reduce(|").slice(0, 3)).toEqual([
      "value",
      "index",
      "acc",
    ]);
    expect(labels("tags.reduce(acc + va|")[0]).toBe("value");
  });

  it("offers them anywhere in the element expression, not in the initial value", () => {
    expect(labels("tags.filter(value != '' && in|")[0]).toBe("index");
    expect(labels("tags.reduce(acc, |")).not.toContain("acc");
    expect(labels("title.contains(va|")).not.toContain("value");
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
    /** The row of `label` once the list shows it. */
    const row = (label: string) =>
      vi.waitFor(() => {
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
    return {
      view,
      row,
      async accept(label: string, { open = true } = {}) {
        if (open) startCompletion(view);
        const option = await row(label);
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

  it("names what a list method binds once it is inserted", async () => {
    using field = editor("tags.fil", typing({ tags: { type: "list" } }));
    await field.accept("filter");
    expect(field.view.state.doc.toString()).toBe("tags.filter()");
    expect(field.view.state.selection.main.head).toBe(12);
    // The list opens by itself on the names `filter` binds.
    await field.accept("value", { open: false });
    expect(field.view.state.doc.toString()).toBe("tags.filter(value)");
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

describe("the members a Query Dataset's planner reads", () => {
  /** The vocabulary of `dataset`, its receivers typed by its planner. */
  const planned = (
    dataset: typeof ITEMS,
    options?: Parameters<typeof datasetReceiver>[1],
  ): ExpressionVocabulary => ({
    fields: [],
    context: false,
    formulas: [],
    receiver: datasetReceiver(dataset, options),
  });

  it("types title., date. and tags. as the planner types them", () => {
    const items = planned(ITEMS);
    expect(labels("title.|", items)).toContain("lower");
    expect(labels("title.|", items)).not.toContain("year");
    expect(labels("date.|", items)).toEqual(
      expect.arrayContaining(["year", "format"]),
    );
    expect(labels("tags.|", items)).toContain("filter");
    expect(labels("tags.|", items)).not.toContain("lower");
  });

  it("offers the Item's fields after item. in an Annotation Query, each one a filter reads", () => {
    const options = offered("item.|", planned(ANNOTATIONS))!.options;
    const fields = options.filter((option) => option.kind === "field");
    expect(fields).toContainEqual({
      label: "title",
      insert: "title",
      kind: "field",
      type: "string",
    });
    expect(fields.map((field) => field.label)).toContain("creators");
    // An Annotation's own field and the custom fields are no members of its Item.
    expect(fields.map((field) => field.label)).not.toContain("comment");
    expect(fields.map((field) => field.label)).not.toContain("custom");
    for (const { label } of fields)
      expect(ANNOTATIONS.planFilter(`item.${label}`)).toHaveProperty("root");
  });

  it("offers an Attachment's fields after attachments[0].", () => {
    const fields = offered("attachments[0].|", planned(ITEMS))!.options.filter(
      (option) => option.kind === "field",
    );
    expect(fields.map((field) => field.label)).toEqual(
      expect.arrayContaining(["title", "fileType"]),
    );
  });

  it("offers every member after creators[0]., whose type a filter knows only per Item", () => {
    const names = labels("creators[0].|", planned(ITEMS));
    expect(names).toEqual(expect.arrayContaining(["lower", "year"]));
    expect(names).not.toContain("fullName");
  });

  it("types this.item as the record the Query Context binds", () => {
    const fields = offered("this.item.|", planned(ITEMS, { context: true }))!
      .options.filter((option) => option.kind === "field")
      .map((option) => option.label);
    expect(fields.sort()).toEqual(["indexedKey", "key"]);
    // Without a Query Context, `this.item` does not plan.
    expect(labels("this.item.|", planned(ITEMS))).toContain("year");
  });

  it("types formula.<name> from the other Formula's planned result", () => {
    const vocabulary = planned(ITEMS, {
      formulas: { short: "title.slice(0, 10)", added: "dateAdded" },
    });
    expect(labels("formula.short.|", vocabulary)).toContain("lower");
    expect(labels("formula.short.|", vocabulary)).not.toContain("year");
    expect(labels("formula.added.|", vocabulary)).toContain("year");
    expect(labels("formula.added.|", vocabulary)).not.toContain("lower");
  });

  it("types a bound name where the list method binds it, not as a custom field", () => {
    const items = planned(ITEMS);
    // `value` alone is a custom field of text; in `tags.filter` it is an element.
    expect(labels("tags.filter(value.|", items)).toContain("year");
    expect(labels("tags.filter(index.|", items)).toContain("toFixed");
    expect(labels("tags.filter(index.|", items)).not.toContain("lower");
    expect(
      offered("attachments.filter(value.|", items)!.options.map((o) => o.label),
    ).toContain("fileType");
    expect(labels("tags.reduce(acc + value.|", items)).toContain("year");
    expect(
      labels("title != '' && attachments.map(value.|).length", items),
    ).toContain("fileType");
  });

  it("gives the Signature Hint the type of a receiver", () => {
    const receiver = datasetReceiver(ITEMS, {
      formulas: { short: "title.slice(0, 10)" },
    });
    const text = "formula.short.lower";
    expect(receiver(text, { from: 0, to: 13 })).toEqual({ type: "string" });
    expect(receiver("formula.missing", { from: 0, to: 15 })).toBeUndefined();
  });
});
