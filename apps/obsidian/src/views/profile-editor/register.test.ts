// @vitest-environment happy-dom
import { setMockPlatform, resetMockPlatform } from "@mock/obsidian";
import { TFile } from "obsidian";
import type { App, Command, Plugin, WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openProfileEditor, registerProfileEditor } from "./register";
import type { ProfileEditorDeps } from "./view";
import { PROFILE_EDITOR_VIEW_TYPE } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
afterEach(resetMockPlatform);

function setup() {
  const file = new TFile();
  file.path = "templates/zotlit-profile.paper.md";
  file.basename = "zotlit-profile.paper";
  file.extension = "md";
  const setViewState = vi.fn(async () => {});
  const leaf = { setViewState } as unknown as WorkspaceLeaf;
  const workspace = {
    getActiveFile: () => file,
    getLeavesOfType: () => [],
    getLeaf: () => leaf,
    revealLeaf: vi.fn(),
    on: vi.fn(),
    onLayoutReady: vi.fn(),
  };
  const app = {
    workspace,
    metadataCache: { getFileCache: () => null },
  } as unknown as App;
  const commands: Command[] = [];
  const registerView = vi.fn();
  const plugin = {
    app,
    registerView,
    addCommand: (command: Command) => commands.push(command),
    registerEvent: vi.fn(),
    register: vi.fn(),
  } as unknown as Plugin;
  const deps = {
    app,
    profile: {
      profiles: [],
      defaultDocumentPath: "templates/zotlit-profile.default.md",
    },
  } as unknown as ProfileEditorDeps &
    Parameters<typeof registerProfileEditor>[1];
  return {
    app,
    file,
    leaf,
    plugin,
    deps,
    commands,
    registerView,
    setViewState,
  };
}

describe("Profile Editor entry points", () => {
  it("registers its own view and command without changing Markdown file associations", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { app, file, plugin, deps, commands, registerView, setViewState } =
      setup();
    registerProfileEditor(plugin, deps);
    expect(registerView).toHaveBeenCalledWith(
      PROFILE_EDITOR_VIEW_TYPE,
      expect.any(Function),
    );
    expect(commands[0]!.checkCallback?.(true)).toBe(true);
    await openProfileEditor(app, file);
    expect(setViewState).toHaveBeenCalledWith({
      type: PROFILE_EDITOR_VIEW_TYPE,
      state: { file: file.path },
      active: true,
    });
  });

  it("keeps registration desktop-only", () => {
    setMockPlatform({ isDesktopApp: false });
    const { plugin, deps, registerView } = setup();
    registerProfileEditor(plugin, deps);
    expect(registerView).not.toHaveBeenCalled();
  });
});
