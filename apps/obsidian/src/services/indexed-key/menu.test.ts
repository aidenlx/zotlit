import { Menu, TFile, TFolder } from "@mock/obsidian";
import type { TAbstractFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerIndexedKeyFileMenu } from "./menu";

type FileMenuHandler = (
  menu: Menu,
  file: TAbstractFile,
  source: string,
) => void;

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

/** Capture the `file-menu` handler the registration installs. */
function fileMenuHandler(
  frontmatter: Record<string, unknown> = { "zotero-key": "ABCD2345g42" },
): FileMenuHandler {
  let handler: FileMenuHandler | undefined;
  registerIndexedKeyFileMenu({
    registerEvent: () => {},
    app: {
      workspace: {
        on: (name: string, cb: FileMenuHandler) => {
          if (name === "file-menu") handler = cb;
          return {};
        },
      },
      metadataCache: { getFileCache: () => ({ frontmatter }) },
    } as never,
  });
  if (!handler) throw new Error("file-menu handler was not registered");
  return handler;
}

function markdownFile(): TFile {
  const file = new TFile();
  file.extension = "md";
  return file;
}

describe("Literature Note file menu", () => {
  it("copies the note's key from the zotlit section", () => {
    const menu = new Menu();
    fileMenuHandler()(menu, markdownFile() as never, "more-options");

    expect(menu.items).toHaveLength(1);
    const copyKey = menu.items[0]!;
    expect(copyKey.title).toBe("Copy item key");
    expect(copyKey.section).toBe("zotlit");

    copyKey.click();
    expect(writeText).toHaveBeenCalledWith("ABCD2345g42");
  });

  it("stays off a multi-file selection", () => {
    const menu = new Menu();
    fileMenuHandler()(menu, markdownFile() as never, "files-menu");

    expect(menu.items).toHaveLength(0);
  });

  it("stays off a non-Markdown file", () => {
    const menu = new Menu();
    const file = new TFile();
    file.extension = "canvas";
    fileMenuHandler()(menu, file as never, "more-options");

    expect(menu.items).toHaveLength(0);
  });

  it("stays off a folder", () => {
    const menu = new Menu();
    fileMenuHandler()(menu, new TFolder() as never, "more-options");

    expect(menu.items).toHaveLength(0);
  });

  it("stays off a note that carries no item key", () => {
    const menu = new Menu();
    fileMenuHandler({})(menu, markdownFile() as never, "more-options");

    expect(menu.items).toHaveLength(0);
  });
});
