import { describe, expect, it } from "vitest";

import { entrySlice, WorkbenchDocumentController } from "./controller";
import type { ManagedEntryAction } from "./manifest-patch";

/**
 * A hand-written Profile whose Managed Frontmatter list carries a comment, a
 * quoted value, one entry that writes `merge` and one that leaves it out, and a
 * keyless Spread Entry, so a patch that rewrites more than it was asked to is
 * visible byte for byte.
 */
const HAND_WRITTEN = `---
# my own profile, do not reformat
name: Reading notes
id: reading
version: 1.0.0
contract: 2
filename: '{{ zt.citationKey }}'
language: liquid
frontmatter:
  # the ones I always want
  - key: title
    expr: zt.title
    merge: replace
  - key: "read on"
    expr: zt.dateAdded
  - value: {"kind":{"$eval":"zt.itemType"}}
    merge: keep
---
# {{ zt.title }}

--- zotlit:annotation ---
> {{ zt.text }}
`;

/**
 * A Profile whose entries write their expressions over several lines — a block
 * mapping and a block scalar — where the YAML node's own end sits on the line
 * under the value.
 */
const MULTI_LINE = HAND_WRITTEN.replace(
  /frontmatter:\n(?: .*\n)+/,
  `frontmatter:
  - key: title
    value: {
      "$eval": "zt.title"
    }
    merge: replace
  - key: subtitle
    expr: >-
      zt.shortTitle
    merge: keep
`,
);

/** Applies one action and returns the source it produced. */
function edit(source: string, action: ManagedEntryAction) {
  const controller = new WorkbenchDocumentController(source);
  expect(controller.editManagedEntry(action)).toBe(true);
  return { controller, source: controller.source };
}

/** Every edit is one undo step, whatever the document's line endings. */
function expectOneUndoStep(
  source: string,
  edit: (controller: WorkbenchDocumentController) => void,
): void {
  for (const document of [source, source.replaceAll("\n", "\r\n")]) {
    const controller = new WorkbenchDocumentController(document);
    edit(controller);
    expect(controller.source).not.toBe(document);
    expect(controller.source.includes("\r\n")).toBe(document.includes("\r\n"));
    expect(controller.undo()).toBe(true);
    expect(controller.source).toBe(document);
    expect(controller.canUndo).toBe(false);
  }
}

describe("Managed Frontmatter patching", () => {
  it("reads every authored entry with its key, language, and merge", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    expect(
      controller.managedEntries!.map(({ position, key, language, merge }) => ({
        position,
        key,
        language,
        merge,
      })),
    ).toEqual([
      { position: 1, key: "title", language: "expr", merge: "replace" },
      { position: 2, key: "read on", language: "expr", merge: "replace" },
      { position: 3, key: undefined, language: "value", merge: "keep" },
    ]);
  });

  it("gives each entry a slice over its own expression", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    expect(controller.sliceText(entrySlice(1))).toBe("zt.title");
    expect(controller.sliceText(entrySlice(3))).toBe(
      '{"kind":{"$eval":"zt.itemType"}}',
    );
  });

  it("changes a value through its own slice and leaves the rest alone", () => {
    expectOneUndoStep(HAND_WRITTEN, (typed) => {
      typed.dispatch({
        changes: {
          ...typed.sliceRange(entrySlice(1)),
          insert: "zt.shortTitle",
        },
        userEvent: "input.type",
      });

      // The line break the document arrived with is asserted by the caller.
      expect(typed.source.replaceAll("\r\n", "\n")).toBe(
        HAND_WRITTEN.replace("expr: zt.title", "expr: zt.shortTitle"),
      );
      expect(typed.problems).toEqual([]);
    });
  });

  it("adds a property at the foot of the list", () => {
    const { source } = edit(HAND_WRITTEN, { action: "add", kind: "property" });

    expect(source).toBe(
      HAND_WRITTEN.replace(
        "    merge: keep\n---",
        "    merge: keep\n  - key: property\n    expr: zt.title\n---",
      ),
    );
    expectOneUndoStep(HAND_WRITTEN, (controller) =>
      controller.editManagedEntry({ action: "add", kind: "property" }),
    );
  });

  it("adds a spread entry that carries no key", () => {
    const { source, controller } = edit(HAND_WRITTEN, {
      action: "add",
      kind: "spread",
    });

    expect(source).toContain(
      '  - value: {"kind":{"$eval":"zt.itemType"},"tags":{"$eval":"zt.tags"}}\n',
    );
    const added = controller.managedEntries!.at(-1)!;
    expect(added).toMatchObject({ position: 4, language: "value" });
    expect(added.key).toBeUndefined();
    expectOneUndoStep(HAND_WRITTEN, (controller) =>
      controller.editManagedEntry({ action: "add", kind: "spread" }),
    );
  });

  it("adds an override directly after the entry it overrides", () => {
    const action: ManagedEntryAction = {
      action: "add",
      kind: "property",
      after: 1,
    };
    const { source, controller } = edit(HAND_WRITTEN, action);

    expect(source).toBe(
      HAND_WRITTEN.replace(
        "    merge: replace\n",
        "    merge: replace\n  - key: property\n    expr: zt.title\n",
      ),
    );
    expect(controller.managedEntries).toHaveLength(4);
    expect(controller.managedEntries?.[1]).toMatchObject({
      position: 2,
      key: "property",
    });
    expectOneUndoStep(HAND_WRITTEN, (controller) =>
      controller.editManagedEntry(action),
    );
  });

  it("writes the list itself when the manifest has no entry yet", () => {
    const bare = HAND_WRITTEN.replace(
      /frontmatter:\n(?: .*\n)+/,
      "frontmatter: []\n",
    );

    const { source } = edit(bare, { action: "add", kind: "property" });

    expect(source).toBe(
      bare.replace(
        "frontmatter: []",
        "frontmatter:\n  - key: property\n    expr: zt.title",
      ),
    );
  });

  it("writes the list into a manifest that never declared one", () => {
    const bare = HAND_WRITTEN.replace(/frontmatter:\n(?: .*\n)+/, "");
    const action: ManagedEntryAction = { action: "add", kind: "property" };

    const { source, controller } = edit(bare, action);

    expect(source).toBe(
      bare.replace(
        "---\n# {{ zt.title }}",
        "frontmatter:\n  - key: property\n    expr: zt.title\n---\n# {{ zt.title }}",
      ),
    );
    expect(controller.managedEntries).toHaveLength(1);
    expect(controller.problems).toEqual([]);
    expectOneUndoStep(bare, (written) => written.editManagedEntry(action));
  });

  it("has no entry to remove while the manifest declares no list", () => {
    const bare = HAND_WRITTEN.replace(/frontmatter:\n(?: .*\n)+/, "");
    const controller = new WorkbenchDocumentController(bare);

    expect(controller.editManagedEntry({ action: "remove", position: 1 })).toBe(
      false,
    );
    expect(controller.source).toBe(bare);
  });

  it("removes one entry and keeps the comment and the entries around it", () => {
    const { source } = edit(HAND_WRITTEN, { action: "remove", position: 2 });

    expect(source).toBe(
      HAND_WRITTEN.replace('  - key: "read on"\n    expr: zt.dateAdded\n', ""),
    );
    expectOneUndoStep(HAND_WRITTEN, (controller) =>
      controller.editManagedEntry({ action: "remove", position: 2 }),
    );
  });

  it("leaves an authored empty list when the last entry goes", () => {
    const single = HAND_WRITTEN.replace(/  - key: "read on"\n(?: .*\n)+/, "");

    const { source, controller } = edit(single, {
      action: "remove",
      position: 1,
    });

    expect(source).toBe(
      single.replace(
        "frontmatter:\n  # the ones I always want\n  - key: title\n    expr: zt.title\n    merge: replace\n",
        "frontmatter: []\n  # the ones I always want\n",
      ),
    );
    expect(controller.managedEntries).toEqual([]);
    expect(controller.problems).toEqual([]);
  });

  it("reorders two entries without rewriting either one", () => {
    const { source } = edit(HAND_WRITTEN, {
      action: "move",
      position: 1,
      by: 1,
    });

    expect(source).toBe(
      HAND_WRITTEN.replace(
        '  - key: title\n    expr: zt.title\n    merge: replace\n  - key: "read on"\n    expr: zt.dateAdded\n',
        '  - key: "read on"\n    expr: zt.dateAdded\n  - key: title\n    expr: zt.title\n    merge: replace\n',
      ),
    );
    expectOneUndoStep(HAND_WRITTEN, (controller) =>
      controller.editManagedEntry({ action: "move", position: 1, by: 1 }),
    );
  });

  it("keeps a comment between two entries between them after a reorder", () => {
    const commented = HAND_WRITTEN.replace(
      '  - key: "read on"',
      '  # when I read it\n  - key: "read on"',
    );

    const { source } = edit(commented, { action: "move", position: 1, by: 1 });

    expect(source).toBe(
      commented.replace(
        '  - key: title\n    expr: zt.title\n    merge: replace\n  # when I read it\n  - key: "read on"\n    expr: zt.dateAdded\n',
        '  - key: "read on"\n    expr: zt.dateAdded\n  # when I read it\n  - key: title\n    expr: zt.title\n    merge: replace\n',
      ),
    );
  });

  it("takes the `-` marker with the entry it introduces", () => {
    const marked = HAND_WRITTEN.replace(
      "  - key: title\n",
      "  -\n    key: title\n",
    );

    const { source, controller } = edit(marked, {
      action: "remove",
      position: 1,
    });

    expect(source).toBe(
      marked.replace(
        "  -\n    key: title\n    expr: zt.title\n    merge: replace\n",
        "",
      ),
    );
    expect(controller.problems).toEqual([]);
  });

  it("refuses to move the first entry up", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    expect(
      controller.editManagedEntry({ action: "move", position: 1, by: -1 }),
    ).toBe(false);
    expect(controller.source).toBe(HAND_WRITTEN);
  });

  it("changes a merge strategy in place", () => {
    const action: ManagedEntryAction = {
      action: "set",
      position: 1,
      field: "merge",
      value: "append",
    };
    const { source } = edit(HAND_WRITTEN, action);

    expect(source).toBe(
      HAND_WRITTEN.replace("    merge: replace", "    merge: append"),
    );
    expectOneUndoStep(HAND_WRITTEN, (controller) =>
      controller.editManagedEntry(action),
    );
  });

  it("writes a merge strategy the entry never declared", () => {
    const { source, controller } = edit(HAND_WRITTEN, {
      action: "set",
      position: 2,
      field: "merge",
      value: "append",
    });

    expect(source).toBe(
      HAND_WRITTEN.replace(
        "    expr: zt.dateAdded\n",
        "    expr: zt.dateAdded\n    merge: append\n",
      ),
    );
    expect(controller.managedEntries![1]).toMatchObject({ merge: "append" });
    expectOneUndoStep(HAND_WRITTEN, (added) =>
      added.editManagedEntry({
        action: "set",
        position: 2,
        field: "merge",
        value: "append",
      }),
    );
  });

  it("renames a property and keeps the quoting the author used", () => {
    const action: ManagedEntryAction = {
      action: "set",
      position: 2,
      field: "key",
      value: "added on",
    };
    const { source } = edit(HAND_WRITTEN, action);

    expect(source).toBe(
      HAND_WRITTEN.replace('key: "read on"', 'key: "added on"'),
    );
    expectOneUndoStep(HAND_WRITTEN, (controller) =>
      controller.editManagedEntry(action),
    );
  });

  it("starts a new expression on a language change, one undo from the old text", () => {
    const action: ManagedEntryAction = {
      action: "language",
      position: 1,
      language: "value",
    };
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    expect(controller.editManagedEntry(action)).toBe(true);
    expect(controller.source).toBe(
      HAND_WRITTEN.replace("expr: zt.title", 'value: {"$eval":"zt.title"}'),
    );
    expect(controller.undo()).toBe(true);
    expect(controller.source).toBe(HAND_WRITTEN);
    expectOneUndoStep(HAND_WRITTEN, (controller) =>
      controller.editManagedEntry(action),
    );
  });

  it("gives a multi-line expression a slice over its own lines alone", () => {
    const controller = new WorkbenchDocumentController(MULTI_LINE);

    expect(controller.sliceText(entrySlice(1))).toBe(
      '{\n      "$eval": "zt.title"\n    }',
    );
    expect(controller.sliceText(entrySlice(2))).toBe(">-\n      zt.shortTitle");
  });

  it("changes the language of a multi-line entry without its next key", () => {
    const fromRule = edit(MULTI_LINE, {
      action: "language",
      position: 1,
      language: "expr",
    });
    const fromScalar = edit(MULTI_LINE, {
      action: "language",
      position: 2,
      language: "value",
    });

    expect(fromRule.source).toBe(
      MULTI_LINE.replace(
        '    value: {\n      "$eval": "zt.title"\n    }',
        "    expr: zt.title",
      ),
    );
    expect(fromRule.controller.problems).toEqual([]);
    expect(fromScalar.source).toBe(
      MULTI_LINE.replace(
        "    expr: >-\n      zt.shortTitle",
        '    value: {"$eval":"zt.title"}',
      ),
    );
    expect(fromScalar.controller.problems).toEqual([]);
  });

  it("keeps a spread entry keyless by refusing a Liquid value", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    expect(
      controller.editManagedEntry({
        action: "language",
        position: 3,
        language: "expr",
      }),
    ).toBe(false);
    expect(controller.source).toBe(HAND_WRITTEN);
  });

  it("leaves a list a form cannot patch to Advanced", () => {
    const controller = new WorkbenchDocumentController(
      HAND_WRITTEN.replace(
        /frontmatter:\n(?: .*\n)+/,
        "frontmatter: [{ key: title, expr: zt.title }]\n",
      ),
    );

    expect(controller.managedEntries).toBeNull();
    expect(
      controller.editManagedEntry({ action: "add", kind: "property" }),
    ).toBe(false);
  });

  it("takes the rows with it when an edit leaves a list no form can patch", () => {
    const flow = HAND_WRITTEN.replace(
      /frontmatter:\n(?: .*\n)+/,
      "frontmatter: [{ key: title, expr: zt.title, merge: nope }]\n",
    );
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    controller.dispatch({
      changes: { from: 0, to: HAND_WRITTEN.length, insert: flow },
    });

    expect(controller.managedEntries).toBeNull();
    expect(controller.problems.map(({ slice }) => slice)).toEqual(["advanced"]);
    expect(controller.sliceRange(entrySlice(1))).toEqual({ from: 0, to: 0 });
  });

  it("keeps the rows it read while the manifest does not parse", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);
    const { from } = controller.sliceRange(entrySlice(3));

    controller.dispatch({ changes: { from, to: from, insert: "[" } });

    expect(controller.managedEntries).toHaveLength(3);
    expect(controller.sliceText(entrySlice(3))).toBe(
      '[{"kind":{"$eval":"zt.itemType"}}',
    );
  });
});
