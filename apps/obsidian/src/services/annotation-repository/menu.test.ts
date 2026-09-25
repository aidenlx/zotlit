import { Menu } from "@mock/obsidian";
import type { TAbstractFile, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { HistorySurface } from "./actions";
import type { HistoryDirection } from "./history";
import { registerAnnotationHistoryFileMenu } from "./menu";

// oxlint-disable-next-line max-params -- Obsidian's own `file-menu` shape.
type FileMenuHandler = (
  menu: Menu,
  file: TAbstractFile,
  source: string,
  leaf?: WorkspaceLeaf,
) => void;

interface Surface extends HistorySurface {
  /** Every step this surface was asked to take, in the order asked. */
  readonly stepped: readonly HistoryDirection[];
}

/** A bound PDF view that records what it was asked to step. */
function surface(historyAttachment: string | null): Surface {
  const stepped: HistoryDirection[] = [];
  return {
    historyAttachment,
    stepped,
    stepHistory: (direction) => stepped.push(direction),
  };
}

/** The leaf a More options menu was opened over. */
const LEAF = { id: "pdf-leaf" } as unknown as WorkspaceLeaf;

/** The registered `file-menu` handler, over one leaf and one history. */
function setup({
  active = surface("RGRPDF24"),
  undo = true,
  redo = true,
}: {
  active?: HistorySurface | null;
  undo?: boolean;
  redo?: boolean;
} = {}) {
  let handler: FileMenuHandler | undefined;
  const app = {
    workspace: {
      on: (name: string, cb: FileMenuHandler) => {
        if (name === "file-menu") handler = cb;
        return {};
      },
    },
  };
  const surfaceFor = vi.fn(() => active);
  registerAnnotationHistoryFileMenu(
    { registerEvent: () => {}, app: app as never },
    {
      annotations: { canUndo: () => undo, canRedo: () => redo },
      surfaceFor,
    },
  );
  if (!handler) throw new Error("file-menu handler was not registered");
  const registered = handler;
  return {
    surfaceFor,
    /** One More options menu, built over the leaf this test names. */
    open: (source = "more-options", leaf: WorkspaceLeaf | null = LEAF) => {
      const menu = new Menu();
      registered(menu, {} as TAbstractFile, source, leaf ?? undefined);
      return menu;
    },
  };
}

describe("the Annotation History file menu", () => {
  it("puts both directions in the zotlit section, under Obsidian's own glyphs", () => {
    const menu = setup().open();

    expect(
      menu.items.map(({ title, section, icon, disabled }) => ({
        title,
        section,
        icon,
        disabled,
      })),
    ).toEqual([
      {
        title: "Undo annotation change",
        section: "zotlit",
        icon: "undo-2",
        disabled: false,
      },
      {
        title: "Redo annotation change",
        section: "zotlit",
        icon: "redo-2",
        disabled: false,
      },
    ]);
  });

  it("steps the view the menu was opened over", () => {
    const active = surface("RGRPDF24");
    const menu = setup({ active }).open();

    menu.items[0]!.click();
    menu.items[1]!.click();

    expect(active.stepped).toEqual(["undo", "redo"]);
  });

  it("asks about the leaf the menu was opened over", () => {
    const { open, surfaceFor } = setup();
    open();

    expect(surfaceFor).toHaveBeenCalledExactlyOnceWith(LEAF);
  });

  it("shows the direction with nothing to step, disabled rather than dropped", () => {
    const active = surface("RGRPDF24");
    const menu = setup({ active, redo: false }).open();

    expect(menu.items.map(({ title, disabled }) => [title, disabled])).toEqual([
      ["Undo annotation change", false],
      ["Redo annotation change", true],
    ]);

    menu.items[1]!.click();
    expect(active.stepped).toEqual([]);
  });

  it("stays off a PDF that is no Zotero Attachment", () => {
    expect(setup({ active: surface(null) }).open().items).toHaveLength(0);
    expect(setup({ active: null }).open().items).toHaveLength(0);
  });

  it("stays off every menu but More options", () => {
    expect(setup().open("tab-header").items).toHaveLength(0);
    expect(setup().open("file-explorer-context-menu").items).toHaveLength(0);
  });

  it("stays off a menu raised for no leaf", () => {
    const { open, surfaceFor } = setup();

    expect(open("more-options", null).items).toHaveLength(0);
    expect(surfaceFor).not.toHaveBeenCalled();
  });
});
