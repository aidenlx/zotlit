// @vitest-environment happy-dom
import { setMockPlatform, resetMockPlatform } from "@mock/obsidian";
import { TFile } from "obsidian";
import type { App, Command, Plugin, WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { profileCustomization, saveProfileCustomization } from "./preferences";
import {
  customizeProfile,
  openProfileEditor,
  registerProfileEditor,
} from "./register";
import type { ProfileEditorDeps } from "./view";
import { PROFILE_EDITOR_VIEW_TYPE } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
const notices = vi.hoisted(() => [] as string[]);
vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<typeof import("obsidian")>()),
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
  },
}));
afterEach(() => {
  resetMockPlatform();
  notices.length = 0;
});

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
  const loadLocalStorage = vi.fn<() => unknown>(() => null);
  const saveLocalStorage = vi.fn();
  const app = {
    workspace,
    loadLocalStorage,
    saveLocalStorage,
    vault: {
      cachedRead: vi.fn(async () => "A document"),
      getFileByPath: vi.fn(() => null),
    },
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
    loadLocalStorage,
    saveLocalStorage,
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
  it("opens the current Literature Note's resolved Default with that paper selected", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { app, file, deps, plugin, commands, setViewState } = setup();
    file.path = "Literature/Figures.md";
    file.basename = "Figures";
    vi.spyOn(app.metadataCache, "getFileCache").mockReturnValue({
      frontmatter: { "zotero-key": "PAPER234" },
    });
    deps.profile.profileOf = vi.fn(
      () =>
        ({ ok: true, profile: { selector: "default" } }) as ReturnType<
          typeof deps.profile.profileOf
        >,
    );
    deps.profile.getSource = vi.fn(async () => "Configured Default");
    registerProfileEditor(plugin, deps);
    const command = commands.find((entry) => entry.id === "customize-profile")!;
    expect(command.checkCallback?.(false)).toBe(true);
    await vi.waitFor(() =>
      expect(setViewState).toHaveBeenCalledWith({
        type: PROFILE_EDITOR_VIEW_TYPE,
        state: { defaultDraft: true, file: null, itemIndexedKey: "PAPER234" },
        active: true,
      }),
    );
  });
  it.each([
    "language: eta",
    "language: liquid\nfrontmatter:\n  - key: title\n    js: zt.title\n    merge: replace",
  ])(
    "opens an advanced Profile natively with a Notice: %s",
    async (manifest) => {
      const { app, file, setViewState } = setup();
      vi.spyOn(app.vault, "cachedRead").mockResolvedValue(
        `---\nid: paper\nname: Paper\nversion: 1.0.0\ncontract: 2\n${manifest}\nfilename: paper\n---\nBody\n--- zotlit:annotation ---\nAnnotation\n`,
      );
      await customizeProfile(app, file);
      expect(notices).toEqual([m.profile_editor_native_required()]);
      expect(setViewState).toHaveBeenCalledOnce();
    },
  );
  it.each(["ask", "web", "native"])(
    "routes saved %s to native until the web launch sheet lands",
    async (preference) => {
      const { app, loadLocalStorage, file, setViewState } = setup();
      loadLocalStorage.mockReturnValue(preference);
      await customizeProfile(app, file, { itemIndexedKey: "0:ABCDEFGH" });
      expect(setViewState).toHaveBeenCalledWith({
        type: PROFILE_EDITOR_VIEW_TYPE,
        state: { file: file.path, itemIndexedKey: "0:ABCDEFGH" },
        active: true,
      });
    },
  );
  it("opens built-in Default from the effective source without ejecting it", async () => {
    const { app, setViewState } = setup();
    const getSource = vi.fn(async () => "Configured built-in document");
    await customizeProfile(app, {
      defaultDocumentPath: "templates/zotlit-profile.default.md",
      getSource,
    });
    expect(getSource).toHaveBeenCalledWith("default");
    expect(setViewState).toHaveBeenCalledWith({
      type: PROFILE_EDITOR_VIEW_TYPE,
      state: { defaultDraft: true, file: null },
      active: true,
    });
  });
  it("stores the preference on this device and treats unknown values as Ask", () => {
    const { app, loadLocalStorage, saveLocalStorage } = setup();
    loadLocalStorage.mockReturnValue("obsolete");
    expect(profileCustomization(app)).toBe("ask");
    saveProfileCustomization(app, "web");
    expect(saveLocalStorage).toHaveBeenCalledWith(
      "zotlit-profile-customization",
      "web",
    );
  });
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

  it("opens the requested Match tab in Basic mode", async () => {
    const { app, file, setViewState } = setup();
    await openProfileEditor(app, file, { tab: "match" });
    expect(setViewState).toHaveBeenCalledWith({
      type: PROFILE_EDITOR_VIEW_TYPE,
      state: { file: file.path, tab: "match", advanced: false },
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
