import { describe, expect, it } from "vitest";

import { entrySlice, WorkbenchDocumentController } from "./controller";

/**
 * A hand-written Profile: an out-of-order manifest with a comment, a single-
 * quoted filename, and a double-quoted description, so an edit that
 * re-serializes the manifest is visible byte for byte.
 */
const HAND_WRITTEN = `---
# my own profile, do not reformat
name: Reading notes
id: reading
version: 1.0.0
description: "Notes I keep for papers"
contract: 2
filename: '{{ zt.citationKey }}'
language: liquid
frontmatter:
  - key: title
    expr: zt.title
    merge: replace
---
# {{ zt.title }}

Read on {{ zt.dateAdded }}.

--- zotlit:annotation ---
> {{ zt.text }}
`;

function noteEdit(
  controller: WorkbenchDocumentController,
  insert: string,
  atEnd = false,
): void {
  const { from, to } = controller.sliceRange("note");
  controller.dispatch({
    changes: { from: atEnd ? to : from, insert },
    userEvent: "input.type",
  });
}

describe("WorkbenchDocumentController", () => {
  it("reads the note body as the region between the manifest and the annotation header", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);
    const { from, to } = controller.sliceRange("note");

    expect(HAND_WRITTEN.slice(from, to)).toBe(
      "# {{ zt.title }}\n\nRead on {{ zt.dateAdded }}.\n\n",
    );
    expect(controller.problems).toEqual([]);
  });

  it("keeps every unrelated manifest byte when a form edit changes one value", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    expect(controller.setManifestValue(["name"], "Paper notes")).toBe(true);

    expect(controller.source).toBe(
      HAND_WRITTEN.replace("name: Reading notes", "name: Paper notes"),
    );
  });

  it("keeps every unrelated byte when a slice edit changes the note body", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    noteEdit(controller, "## Summary\n\n");

    expect(controller.source).toBe(
      HAND_WRITTEN.replace(
        "# {{ zt.title }}",
        "## Summary\n\n# {{ zt.title }}",
      ),
    );
  });

  it("patches a CRLF document without changing its line endings", () => {
    const crlf = HAND_WRITTEN.replaceAll("\n", "\r\n");
    const controller = new WorkbenchDocumentController(crlf);

    expect(controller.setManifestValue(["id"], "papers")).toBe(true);
    noteEdit(controller, "hello ");

    expect(controller.source).toBe(
      crlf
        .replace("id: reading", "id: papers")
        .replace("# {{ zt.title }}", "hello # {{ zt.title }}"),
    );
    expect(controller.source.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("inserts a line break in the form the document already uses", () => {
    const crlf = HAND_WRITTEN.replaceAll("\n", "\r\n");
    const controller = new WorkbenchDocumentController(crlf);

    noteEdit(controller, "line one\nline two\n");

    expect(controller.source).toBe(
      crlf.replace(
        "# {{ zt.title }}",
        "line one\r\nline two\r\n# {{ zt.title }}",
      ),
    );
    expect(controller.source.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("routes form and slice edits through one undo history, newest first", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    noteEdit(controller, "one ");
    controller.setManifestValue(["version"], "1.1.0");

    expect(controller.source).toContain("version: 1.1.0");
    controller.undo();
    expect(controller.source).toContain("version: 1.0.0");
    expect(controller.source).toContain("one # {{ zt.title }}");
    controller.undo();
    expect(controller.source).toBe(HAND_WRITTEN);
    expect(controller.canUndo).toBe(false);
    expect(controller.canRedo).toBe(true);
  });

  it("spans the whole document with the Advanced range", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);
    noteEdit(controller, "one ");

    const advanced = controller.sliceRange("advanced");
    expect(controller.source.slice(advanced.from, advanced.to)).toBe(
      controller.source,
    );

    controller.undo();
    expect(controller.source).toBe(HAND_WRITTEN);
  });

  it("keeps the note offsets correct after an edit in the manifest", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);
    const before = controller.sliceRange("note");

    controller.setManifestValue(["description"], "Notes I keep for the papers");

    const after = controller.sliceRange("note");
    expect(after.from).toBe(before.from + 4);
    expect(controller.source.slice(after.from, after.to)).toBe(
      "# {{ zt.title }}\n\nRead on {{ zt.dateAdded }}.\n\n",
    );
  });

  it("keeps the draft editable and reports the first problem when it stops parsing", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);
    const annotationHeader = HAND_WRITTEN.indexOf("--- zotlit:annotation ---");

    controller.dispatch({
      changes: {
        from: annotationHeader,
        to: annotationHeader + "--- zotlit:annotation ---".length,
        insert: "--- zotlit:nope ---",
      },
    });

    expect(controller.document).toBeNull();
    const [problem] = controller.problems;
    expect(problem).toMatchObject({
      code: "unknown-section-header",
      slice: "advanced",
    });
    const { from, to } = problem!.range!;
    expect(controller.source.slice(from, to)).toBe("--- zotlit:nope ---");

    controller.undo();
    expect(controller.problems).toEqual([]);
  });

  it("points a manifest validation error at the field that failed", () => {
    const controller = new WorkbenchDocumentController(
      HAND_WRITTEN.replace("contract: 2", "contract: two"),
    );

    const [problem] = controller.problems;
    expect(problem).toMatchObject({
      code: "invalid-manifest",
      slice: "advanced",
    });
    const { from, to } = problem!.range!;
    expect(controller.source.slice(from, to)).toBe("two");
  });

  it("sends a manifest error the parser pins to one entry to that row", () => {
    const controller = new WorkbenchDocumentController(
      HAND_WRITTEN.replace("merge: replace", "merge: sometimes"),
    );

    const [problem] = controller.problems;
    expect(problem).toMatchObject({
      code: "invalid-manifest",
      slice: entrySlice(1),
    });
    const { from, to } = problem!.range!;
    expect(controller.source.slice(from, to).trimEnd()).toBe(
      "key: title\n    expr: zt.title\n    merge: sometimes",
    );
  });

  it("reports an Eta profile as unsupported on the web and points at the value", () => {
    const controller = new WorkbenchDocumentController(
      HAND_WRITTEN.replace("language: liquid", "language: eta"),
    );

    const [problem] = controller.problems;
    expect(problem).toMatchObject({ code: "unsupported-language" });
    const { from, to } = problem!.range!;
    expect(controller.source.slice(from, to)).toBe("eta");
  });

  it("reads the note name as the text inside the quotes the author wrote", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);
    const filename = controller.filenameSlice!;

    expect(HAND_WRITTEN.slice(filename.from, filename.to)).toBe(
      "{{ zt.citationKey }}",
    );
    expect(controller.sliceRange("filename")).toEqual(filename);
  });

  it("leaves a note name no one line can hold to Advanced", () => {
    const controller = new WorkbenchDocumentController(
      HAND_WRITTEN.replace(
        "filename: '{{ zt.citationKey }}'",
        "filename: |\n  {{ zt.citationKey }}",
      ),
    );

    expect(controller.problems).toEqual([]);
    expect(controller.filenameSlice).toBeNull();
  });

  it("edits the note name through its own slice, quotes untouched", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);
    const { from } = controller.filenameSlice!;

    controller.dispatch({
      changes: { from, insert: "{{ zt.date }}-" },
      userEvent: "input.type",
    });

    expect(controller.source).toBe(
      HAND_WRITTEN.replace(
        "filename: '{{ zt.citationKey }}'",
        "filename: '{{ zt.date }}-{{ zt.citationKey }}'",
      ),
    );
  });

  it("writes a binding the manifest never carried, then takes the key away", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    expect(controller.setManifestKey("folder", "literatures")).toBe(true);
    // A key the manifest never wrote lands at its foot, so no line the author
    // ordered has to move.
    expect(controller.source).toBe(
      HAND_WRITTEN.replace(
        "---\n# {{ zt.title }}",
        "folder: literatures\n---\n# {{ zt.title }}",
      ),
    );
    expect(controller.document?.manifest.folder).toBe("literatures");

    expect(controller.setManifestKey("folder", undefined)).toBe(true);
    expect(controller.source).toBe(HAND_WRITTEN);
  });

  it("keeps an explicit empty path and an explicit false apart from unset", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    controller.setManifestKey("folder", "");
    controller.setManifestKey("importColoredHighlights", false);

    expect(controller.problems).toEqual([]);
    const { manifest } = controller.document!;
    expect(manifest.folder).toBe("");
    expect(manifest.importColoredHighlights).toBe(false);
    expect(manifest.importFolder).toBeUndefined();
  });

  it("removes one binding key and leaves the line the author commented", () => {
    const source = HAND_WRITTEN.replace(
      "language: liquid",
      "folder: papers # where they land\ncitationStyle: null\nlanguage: liquid",
    );
    const controller = new WorkbenchDocumentController(source);

    expect(controller.setManifestKey("folder", undefined)).toBe(true);

    expect(controller.source).toBe(
      source.replace("folder: papers # where they land\n", ""),
    );
    expect(controller.document?.manifest.citationStyle).toBeNull();
  });

  it("refuses a key whose value spans lines no form owns", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    expect(controller.setManifestKey("frontmatter", undefined)).toBe(false);

    expect(controller.source).toBe(HAND_WRITTEN);
  });

  it("undoes one Override in one step", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    controller.setManifestKey("importFolder", "zotero_notes");
    controller.undo();

    expect(controller.source).toBe(HAND_WRITTEN);
  });

  it("changes the language key and leaves every template source as it was", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);

    expect(controller.setManifestKey("language", "eta")).toBe(true);

    expect(controller.source).toBe(
      HAND_WRITTEN.replace("language: liquid", "language: eta"),
    );
  });

  it("applies a form edit while the focused slice has no editor open", () => {
    const controller = new WorkbenchDocumentController(HAND_WRITTEN);
    controller.setFocusedSlice("advanced");

    expect(controller.setManifestValue(["name"], "Paper notes")).toBe(true);
    expect(controller.source).toBe(
      HAND_WRITTEN.replace("name: Reading notes", "name: Paper notes"),
    );
  });
});
