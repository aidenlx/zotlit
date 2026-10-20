// @vitest-environment happy-dom
// Choosing an Annotation Suggester result: the trigger text gives way to the
// annotation rendered through the user's template.
import type { App, Editor, MarkdownFileInfo, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type {
  AnnotationList,
  AnnotationRecord,
} from "@/services/annotation-repository/service";
import type { NoteFeature } from "@/services/note-feature";
import { stateEditor } from "@/views/annot-view/__fixtures__/editor";

import { insertAnnotation } from "./annotation-insert";
import type { AnnotationHit } from "./annotation-search";

const hit: AnnotationHit = {
  key: "ANN2HGHT",
  attachmentKey: "PDF2LIVE",
  itemKey: "ART2FULL",
  type: "highlight",
  text: "an exact match",
  comment: null,
  color: "#ffd400",
  pageLabel: "4",
  title: "Exact Matching in Literature Review",
  citationKey: "smith2020",
};

const record: AnnotationRecord = {
  key: "ANN2HGHT",
  parentKey: "PDF2LIVE",
  type: "highlight",
  color: "#ffd400",
  comment: null,
  text: "an exact match",
  pageLabel: "4",
  sortIndex: "00000|000000|00000",
  tags: [],
  version: null,
  lock: null,
  position: { kind: "pdf-rects", pageIndex: 3, rects: [[1, 2, 3, 4]] },
};

const list: AnnotationList = {
  source: {
    kind: "zotero-db",
    database: { userID: null, localUserKey: null, serverID: null },
    libraryID: 1,
    libraryRevision: null,
  },
  annotations: [record],
};

const LINK = "zotero://open/library/items/PDF2LIVE?annotation=ANN2HGHT&page=4";

function setup(
  doc: string,
  {
    rendered,
    annotations = list,
  }: { rendered: string; annotations?: AnnotationList | null },
) {
  const cm = stateEditor({ doc });
  const editor = {
    cm,
    getValue: () => cm.state.doc.toString(),
  } as unknown as Editor;
  const info = {
    editor,
    file: { path: "Draft.md" } as TFile,
  } as MarkdownFileInfo;
  const prepare = vi.fn<NoteFeature["prepareAnnotationInsert"]>(async () => ({
    text: rendered,
    summary: {
      zotero: 0,
      unchecked: 0,
      unavailable: 0,
      written: 0,
      reused: 0,
    } as never,
  }));
  const read = vi.fn(async (_key: string) => annotations);
  const record = vi.fn();
  const notices: (string | DocumentFragment)[] = [];
  const deps = {
    app: {} as App,
    annotations: { read },
    noteFeature: { prepareAnnotationInsert: prepare },
    zoteroPref: { dataDir: "/zotero" },
    useLedger: { record },
    notify: (message: string | DocumentFragment) => void notices.push(message),
  };
  const insert = (from: number, to: number) =>
    insertAnnotation(deps, {
      hit,
      info,
      isCurrent: () => true,
      range: { from, to },
    });
  return {
    insert,
    prepare,
    read,
    record,
    notices,
    text: () => cm.state.doc.toString(),
    [Symbol.dispose]: () => cm.destroy(),
  };
}

describe("insertAnnotation", () => {
  it("replaces the trigger text with the rendered annotation and one trailing space", async () => {
    const inline = `“an exact match” [Zotero](${LINK})`;
    using h = setup("As shown [>exact] here", { rendered: inline });
    await h.insert(9, 17);
    expect(h.text()).toBe(`As shown ${inline} here`);
  });

  it("adds the space where none follows", async () => {
    const inline = `“an exact match” [Zotero](${LINK})`;
    using h = setup("As shown [>exact]", { rendered: inline });
    await h.insert(9, 17);
    expect(h.text()).toBe(`As shown ${inline} `);
  });

  it("renders from the database list it reads, in the scope of the Zotero data folder", async () => {
    using h = setup("[>exact]", { rendered: "quote" });
    await h.insert(0, 8);
    expect(h.read).toHaveBeenCalledWith("PDF2LIVE");
    expect(h.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: record,
        source: list.source,
        sourceScope: "/zotero",
        notePath: "Draft.md",
      }),
    );
  });

  it("sets a rendered callout apart as a block, with no trailing space", async () => {
    const callout = `> [!note] Page [4](${LINK})\n> an exact match\n`;
    using h = setup("Before\n[>exact]\nAfter", { rendered: callout });
    await h.insert(7, 15);
    expect(h.text()).toBe(
      `Before\n\n> [!note] Page [4](${LINK})\n> an exact match\n\nAfter`,
    );
  });

  it("records a Use of the paper once the text lands", async () => {
    using h = setup("[>exact]", { rendered: "quote" });
    await h.insert(0, 8);
    expect(h.record).toHaveBeenCalledWith("ART2FULL", "cited");
  });

  it("leaves the trigger text and tells the researcher when the annotation is gone", async () => {
    using h = setup("[>exact]", {
      rendered: "quote",
      annotations: { ...list, annotations: [] },
    });
    await h.insert(0, 8);
    expect(h.text()).toBe("[>exact]");
    expect(h.notices).toEqual([m.annotation_suggest_unavailable()]);
    expect(h.record).not.toHaveBeenCalled();
    expect(h.prepare).not.toHaveBeenCalled();
  });
});
