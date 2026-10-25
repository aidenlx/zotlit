import type { App, Workspace, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
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
    const app = stubService<App>("App", {
      workspace: stubService<Workspace>("Workspace", {
        getLeavesOfType,
        getRightLeaf,
      }),
    });
    await openTemplateDataExplorer(app);
    expect(openProfileExplorer).toHaveBeenCalledWith(app, editor);
    expect(getLeavesOfType).not.toHaveBeenCalled();
    expect(getRightLeaf).not.toHaveBeenCalled();
  });
});

it("opens an explicit Item in an unlinked unpinned Explorer and preserves other groups", async () => {
  const editor = {} as TemplateWorkbenchView;
  vi.mocked(activeTemplateWorkbench).mockReturnValue(editor);
  const grouped = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    group: "other-workbench",
    pinned: false,
    setViewState: vi.fn(),
  });
  const pinned = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    group: null,
    pinned: true,
    setViewState: vi.fn(),
  });
  const standalone = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    group: null,
    pinned: false,
    setViewState: vi.fn(async () => {}),
  });
  const revealLeaf = vi.fn();
  const getRightLeaf = vi.fn();
  const app = stubService<App>("App", {
    workspace: stubService<Workspace>("Workspace", {
      getLeavesOfType: () => [grouped, pinned, standalone],
      getRightLeaf,
      revealLeaf,
    }),
  });
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
  const existing = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    group: "saved-group",
    pinned: true,
    setViewState: vi.fn(),
  });
  const created = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    setViewState: vi.fn(async () => {}),
  });
  const getRightLeaf = vi.fn(() => created);
  const app = stubService<App>("App", {
    workspace: stubService<Workspace>("Workspace", {
      getLeavesOfType: () => [existing],
      getRightLeaf,
      revealLeaf: vi.fn(),
    }),
  });
  await openTemplateDataExplorer(app, { itemIndexedKey: "PAPER002" });
  expect(getRightLeaf).toHaveBeenCalledWith(true);
  expect(existing.setViewState).not.toHaveBeenCalled();
  expect(created.setViewState).toHaveBeenCalledWith(
    expect.objectContaining({
      state: { itemIndexedKey: "PAPER002", zotlitLaunch: true },
    }),
  );
});

it.each(["tab"] as const)(
  "puts the Explorer in a new %s the link names, leaving the sidebar one alone",
  async (paneType) => {
    vi.mocked(activeTemplateWorkbench).mockReturnValue(null);
    const sidebar = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      group: null,
      pinned: false,
      setViewState: vi.fn(),
    });
    const created = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      setViewState: vi.fn(async () => {}),
    });
    const getLeaf = vi.fn(() => created);
    const getRightLeaf = vi.fn();
    const revealLeaf = vi.fn();
    const app = stubService<App>("App", {
      workspace: stubService<Workspace>("Workspace", {
        getLeavesOfType: () => [sidebar],
        getLeaf,
        getRightLeaf,
        revealLeaf,
      }),
    });
    await openTemplateDataExplorer(
      app,
      { itemIndexedKey: "PAPER002" },
      {
        paneType,
      },
    );
    expect(getLeaf).toHaveBeenCalledExactlyOnceWith(paneType);
    expect(getRightLeaf).not.toHaveBeenCalled();
    expect(sidebar.setViewState).not.toHaveBeenCalled();
    expect(created.setViewState).toHaveBeenCalledWith({
      type: "zotlit-template-data-explorer",
      active: true,
      state: { itemIndexedKey: "PAPER002", zotlitLaunch: true },
    });
    expect(revealLeaf).toHaveBeenCalledWith(created);
  },
);
