import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  activeTemplateWorkbench,
  openProfileExplorer,
} from "@/views/note-preview/register";
import type { TemplateWorkbenchView } from "@/views/template-workbench/view";

import { openTemplateDataExplorer } from "./register";

vi.mock("@/views/note-preview/register", () => ({
  activeTemplateWorkbench: vi.fn(),
  openProfileExplorer: vi.fn(async () => {}),
}));
vi.mock("./view", () => ({
  EXPLORER_VIEW_TYPE: "zotlit-template-data-explorer",
  TemplateDataExplorerView: class {},
}));

describe("Explorer entry point", () => {
  it("reopens fields beside the active workbench editor instead of selecting another window", async () => {
    const editor = { leaf: { group: "native-group" } } as TemplateWorkbenchView;
    vi.mocked(activeTemplateWorkbench).mockReturnValue(editor);
    const getLeavesOfType = vi.fn();
    const getRightLeaf = vi.fn();
    const app = {
      workspace: { getLeavesOfType, getRightLeaf },
    } as unknown as App;
    await openTemplateDataExplorer(app);
    expect(openProfileExplorer).toHaveBeenCalledWith(app, editor);
    expect(getLeavesOfType).not.toHaveBeenCalled();
    expect(getRightLeaf).not.toHaveBeenCalled();
  });
});

it("opens an explicit Item in an unlinked unpinned Explorer and preserves other groups", async () => {
  const editor = {} as TemplateWorkbenchView;
  vi.mocked(activeTemplateWorkbench).mockReturnValue(editor);
  const grouped = {
    group: "other-workbench",
    pinned: false,
    setViewState: vi.fn(),
  };
  const pinned = { group: null, pinned: true, setViewState: vi.fn() };
  const standalone = {
    group: null,
    pinned: false,
    setViewState: vi.fn(async () => {}),
  };
  const revealLeaf = vi.fn();
  const getRightLeaf = vi.fn();
  const app = {
    workspace: {
      getLeavesOfType: () => [grouped, pinned, standalone],
      getRightLeaf,
      revealLeaf,
    },
  } as unknown as App;
  await openTemplateDataExplorer(app, { itemIndexedKey: "PAPER002" });
  expect(standalone.setViewState).toHaveBeenCalledWith({
    type: "zotlit-template-data-explorer",
    active: true,
    state: { itemIndexedKey: "PAPER002", zotlitLaunch: true },
  });
  expect(grouped.setViewState).not.toHaveBeenCalled();
  expect(pinned.setViewState).not.toHaveBeenCalled();
  expect(getRightLeaf).not.toHaveBeenCalled();
  expect(revealLeaf).toHaveBeenCalledWith(standalone);
});

it("creates an explicit Explorer instead of replacing a pinned or grouped pane", async () => {
  vi.mocked(activeTemplateWorkbench).mockReturnValue(null);
  const existing = {
    group: "saved-group",
    pinned: true,
    setViewState: vi.fn(),
  };
  const created = { setViewState: vi.fn(async () => {}) };
  const getRightLeaf = vi.fn(() => created);
  const app = {
    workspace: {
      getLeavesOfType: () => [existing],
      getRightLeaf,
      revealLeaf: vi.fn(),
    },
  } as unknown as App;
  await openTemplateDataExplorer(app, { itemIndexedKey: "PAPER002" });
  expect(getRightLeaf).toHaveBeenCalledWith(true);
  expect(existing.setViewState).not.toHaveBeenCalled();
  expect(created.setViewState).toHaveBeenCalledWith(
    expect.objectContaining({
      state: { itemIndexedKey: "PAPER002", zotlitLaunch: true },
    }),
  );
});
