import { Menu, TFile, TFolder } from "@mock/obsidian";
import { describe, expect, it, vi } from "vitest";

import { fileMenuHandler } from "./__fixtures__/file-menu";
import type { FileMenuContext, FileMenuSegment } from "./file-menu";

function fileOf(extension: string): TFile {
  const file = new TFile();
  file.extension = extension;
  return file;
}

/** A segment that records what it read and adds one row titled `title`. */
function recording(title: string, seen: FileMenuContext[] = []) {
  const segment: FileMenuSegment = (menu, ctx) => {
    seen.push(ctx);
    menu.addItem((item) => item.setTitle(title));
  };
  return { segment, seen };
}

describe("registerFileMenu", () => {
  it("runs the segments in the order given", () => {
    const menu = new Menu();
    fileMenuHandler([recording("first").segment, recording("second").segment])(
      menu as never,
      fileOf("md") as never,
      "file-explorer-context-menu",
    );

    expect(menu.items.map((item) => item.title)).toStrictEqual([
      "first",
      "second",
    ]);
  });

  it("reads a Literature Note's Item key once for every segment", () => {
    const { segment, seen } = recording("row");
    const file = fileOf("md");
    const leaf = {};
    fileMenuHandler([segment, segment], { "zotero-key": "ABCD2345g42" })(
      new Menu() as never,
      file as never,
      "more-options",
      leaf as never,
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).toStrictEqual({
      file,
      source: "more-options",
      leaf,
      itemKey: "ABCD2345g42",
      noteKey: null,
    });
    expect(seen[1]).toBe(seen[0]);
  });

  it("reads a Note Import's note key", () => {
    const { segment, seen } = recording("row");
    fileMenuHandler([segment], { "zotero-note-key": "NNNN2345g42" })(
      new Menu() as never,
      fileOf("md") as never,
      "tab-header",
    );

    expect(seen[0]).toMatchObject({ itemKey: null, noteKey: "NNNN2345g42" });
  });

  it("reads no frontmatter keys off a file that is not Markdown", () => {
    const { segment, seen } = recording("row");
    fileMenuHandler([segment], { "zotero-key": "ABCD2345g42" })(
      new Menu() as never,
      fileOf("pdf") as never,
      "more-options",
    );

    expect(seen[0]).toMatchObject({ itemKey: null, noteKey: null });
  });

  it("runs no segment for a folder", () => {
    const segment = vi.fn<FileMenuSegment>();
    fileMenuHandler([segment])(
      new Menu() as never,
      new TFolder() as never,
      "file-explorer-context-menu",
    );

    expect(segment).not.toHaveBeenCalled();
  });
});
