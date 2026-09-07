import { Menu } from "@mock/obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createExplorerActions } from "./actions";

function makeActions(overrides?: {
  copyTarget?: () => {
    indexedKey: string;
    kind: "item" | "annotation";
  } | null;
  canExport?: () => boolean;
  onExport?: () => void;
}) {
  return createExplorerActions({
    onChooseItem: vi.fn(),
    onBackToNoteRoot: vi.fn(),
    onRefresh: vi.fn(),
    copyTarget: overrides?.copyTarget ?? (() => null),
    canExport: overrides?.canExport ?? (() => true),
    onExport: overrides?.onExport ?? vi.fn(),
  });
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Menu.instances.length = 0;
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pane menu — copy key", () => {
  it("offers the object displayed by the current root", () => {
    const menu = new Menu();
    const actions = makeActions({
      copyTarget: () => ({ indexedKey: "ANNO2345g42", kind: "annotation" }),
    });

    expect(actions.addCopyKeyMenuItem(menu as never)).toBe(true);
    expect(menu.items[0]!.title).toBe("Copy annotation key");
    // The pane menu groups by section, alongside Obsidian's own entries.
    expect(menu.items[0]!.section).toBe("zotlit");

    menu.items[0]!.click();
    expect(writeText).toHaveBeenCalledWith("ANNO2345g42");
  });

  it("adds nothing when no object is displayed", () => {
    const menu = new Menu();
    const actions = makeActions({ copyTarget: () => null });

    expect(actions.addCopyKeyMenuItem(menu as never)).toBe(false);
    expect(menu.items).toHaveLength(0);
  });
});

describe("pane menu — export", () => {
  it("adds a zotlit-section export entry that runs the export", () => {
    const onExport = vi.fn();
    const menu = new Menu();

    makeActions({ onExport }).addExportMenuItem(menu as never);

    expect(menu.items).toHaveLength(1);
    expect(menu.items[0]!.section).toBe("zotlit");
    menu.items[0]!.click();
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("adds nothing while no template data is built", () => {
    const menu = new Menu();

    makeActions({ canExport: () => false }).addExportMenuItem(menu as never);

    expect(menu.items).toHaveLength(0);
  });
});
