import { Menu, TFile, TFolder } from "@mock/obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fileMenuHandler as handlerFor } from "@/services/__fixtures__/file-menu";

import { indexedKeyFileMenu } from "./menu";

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

function fileMenuHandler(
  frontmatter: Record<string, unknown> = { "zotero-key": "ABCD2345g42" },
) {
  return handlerFor([indexedKeyFileMenu()], frontmatter);
}

function markdownFile(): TFile {
  const file = new TFile();
  file.extension = "md";
  return file;
}

describe("Literature Note file menu", () => {
  it("copies the note's key from the info section", () => {
    const menu = new Menu();
    fileMenuHandler()(menu as never, markdownFile() as never, "more-options");

    expect(menu.items).toHaveLength(1);
    const copyKey = menu.items[0]!;
    expect(copyKey.title).toBe("Copy item key");
    expect(copyKey.section).toBe("info");

    copyKey.click();
    expect(writeText).toHaveBeenCalledWith("ABCD2345g42");
  });

  it("stays off a non-Markdown file", () => {
    const menu = new Menu();
    const file = new TFile();
    file.extension = "canvas";
    fileMenuHandler()(menu as never, file as never, "more-options");

    expect(menu.items).toHaveLength(0);
  });

  it("stays off a folder", () => {
    const menu = new Menu();
    fileMenuHandler()(menu as never, new TFolder() as never, "more-options");

    expect(menu.items).toHaveLength(0);
  });

  it("stays off a note that carries no item key", () => {
    const menu = new Menu();
    fileMenuHandler({})(menu as never, markdownFile() as never, "more-options");

    expect(menu.items).toHaveLength(0);
  });
});
