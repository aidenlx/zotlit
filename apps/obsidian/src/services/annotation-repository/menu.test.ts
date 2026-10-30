import { Menu } from "@mock/obsidian";
import type { MenuItem as MockMenuItem } from "@mock/obsidian";
import { Effect } from "effect";
import { TFile } from "obsidian";
import type { Menu as ObsidianMenu, MenuItem, WorkspaceLeaf } from "obsidian";
import { afterAll, describe, expect, it, vi } from "vitest";

import { openTestBridge } from "@/lib/__fixtures__/effect-bridge";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { fileMenuHandler } from "@/services/__fixtures__/file-menu";

import type { HistorySurface } from "./actions";
import type { HistoryDirection } from "./history";
import { annotationHistoryFileMenu } from "./menu";

const bridge = openTestBridge();
afterAll(() => bridge[Symbol.asyncDispose]());

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
const LEAF = stubService<WorkspaceLeaf>("WorkspaceLeaf", { id: "pdf-leaf" });

/** The mock menu behind the public Obsidian `Menu` type its consumer takes. */
function obsidianMenu(menu: Menu): ObsidianMenu {
  const typed = Object.assign(stubService<ObsidianMenu>("Menu", {}), {
    addItem(callback: (item: MenuItem) => unknown): ObsidianMenu {
      menu.addItem((item) => callback(obsidianMenuItem(item)));
      return typed;
    },
  });
  return typed;
}

/** The mock item behind the public Obsidian `MenuItem` type. */
function obsidianMenuItem(item: MockMenuItem): MenuItem {
  const typed = Object.assign(stubService<MenuItem>("MenuItem", {}), {
    setSection(section: string): MenuItem {
      item.setSection(section);
      return typed;
    },
    setTitle(title: string): MenuItem {
      item.setTitle(title);
      return typed;
    },
    setIcon(icon: string): MenuItem {
      item.setIcon(icon);
      return typed;
    },
    setDisabled(disabled: boolean): MenuItem {
      item.setDisabled(disabled);
      return typed;
    },
    onClick(
      callback: (event: MouseEvent | KeyboardEvent) => unknown,
    ): MenuItem {
      item.onClick(callback);
      return typed;
    },
  });
  return typed;
}

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
  const surfaceFor = vi.fn(() => active);
  const registered = fileMenuHandler([
    annotationHistoryFileMenu({
      annotations: {
        canUndo: () => Effect.succeed(undo),
        canRedo: () => Effect.succeed(redo),
      },
      bridge,
      surfaceFor,
    }),
  ]);
  const pdf = new TFile();
  pdf.extension = "pdf";
  return {
    surfaceFor,
    /** One More options menu, built over the leaf this test names. */
    open: (source = "more-options", leaf: WorkspaceLeaf | null = LEAF) => {
      const menu = new Menu();
      registered(obsidianMenu(menu), pdf, source, leaf ?? undefined);
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
        section: "action",
        icon: "undo-2",
        disabled: false,
      },
      {
        title: "Redo annotation change",
        section: "action",
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
