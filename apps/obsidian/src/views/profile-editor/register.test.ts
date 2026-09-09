// @vitest-environment happy-dom
import { Menu, resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { TFile } from "obsidian";
import type { App, Command, Plugin, WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import {
  findProfileWorkbench,
  openProfileWorkbench,
} from "@/views/note-preview/register";

import { profileCustomization, saveProfileCustomization } from "./preferences";
import {
  openNativeProfile,
  requiresNative,
  openProfileEditor,
  registerProfileEditor,
} from "./register";
import type { ProfileEditorDeps } from "./view";
import { PROFILE_EDITOR_VIEW_TYPE, ProfileEditorView } from "./view";

vi.mock("@/views/note-preview/register", () => ({
  openProfileWorkbench: vi.fn(async () => {}),
  findProfileWorkbench: vi.fn(async () => null),
}));

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
afterEach(() => {
  resetMockPlatform();
  vi.mocked(findProfileWorkbench).mockReset().mockResolvedValue(null);
});

function setup() {
  const file = new TFile();
  file.path = "templates/zotlit-profile.paper.md";
  file.basename = "zotlit-profile.paper";
  file.extension = "md";
  const setViewState = vi.fn(async () => {});
  const focusWindow = vi.fn();
  const leaf = {
    setViewState,
    getContainer: () => ({ focus: focusWindow }),
  } as unknown as WorkspaceLeaf;
  const fileMenuHandlers: ((menu: Menu, file: TFile) => void)[] = [];
  const workspace = {
    getActiveFile: () => file,
    getLeavesOfType: () => [],
    getLeaf: () => leaf,
    revealLeaf: vi.fn(),
    on: vi.fn((event: string, handler: (menu: Menu, file: TFile) => void) => {
      if (event === "file-menu") fileMenuHandlers.push(handler);
    }),
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
    webWorkbenchEnabled: true,
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
    fileMenu: () => {
      const menu = new Menu();
      for (const handler of fileMenuHandlers) handler(menu, file);
      return menu;
    },
    registerView,
    setViewState,
    focusWindow,
  };
}

describe("Profile Editor entry points", () => {
  it.each(["named", "copied-default", "default"])(
    "applies a Customize launch Item to the existing %s workbench and leaves its compact editor unchanged",
    async (kind) => {
      const {
        app,
        file,
        leaf: compactLeaf,
        setViewState: compactSetState,
      } = setup();
      if (kind === "default") file.path = "templates/zotlit-profile.default.md";
      if (kind !== "named") {
        vi.spyOn(app.vault, "cachedRead").mockResolvedValue(`---
id: default
name: Default
version: 1.0.0
contract: 2
filename: "{{ zt.title }}"
---
Body
--- zotlit:annotation ---
Annotation`);
      }
      const chooseCompactItem = vi.fn();
      const chooseWorkbenchItem = vi.fn();
      const compact = Object.assign(
        Object.create(ProfileEditorView.prototype),
        { file, leaf: compactLeaf, chooseItem: chooseCompactItem },
      ) as ProfileEditorView;
      Object.assign(compactLeaf, { view: compact });
      const workbenchSetState = vi.fn(async () => {});
      const workbenchLeaf = {
        setViewState: workbenchSetState,
        getContainer: () => ({ focus: vi.fn() }),
      } as unknown as WorkspaceLeaf;
      const workbench = Object.assign(
        Object.create(ProfileEditorView.prototype),
        { file, leaf: workbenchLeaf, chooseItem: chooseWorkbenchItem },
      ) as ProfileEditorView;
      Object.assign(workbenchLeaf, { view: workbench });
      vi.spyOn(app.workspace, "getLeavesOfType").mockReturnValue([
        compactLeaf,
        workbenchLeaf,
      ]);
      vi.mocked(findProfileWorkbench).mockResolvedValueOnce(workbench);
      await openNativeProfile(app, file, {
        customize: true,
        itemIndexedKey: "MAIN2345",
      });
      expect(findProfileWorkbench).toHaveBeenCalledWith(app, {
        file: file.path,
        defaultProfile: false,
      });
      expect(workbenchSetState).toHaveBeenCalledWith({
        type: PROFILE_EDITOR_VIEW_TYPE,
        state: { file: file.path, itemIndexedKey: "MAIN2345" },
        active: true,
      });
      expect(compactSetState).not.toHaveBeenCalled();
      expect(openProfileWorkbench).toHaveBeenLastCalledWith(app, workbench);
      expect(chooseWorkbenchItem).not.toHaveBeenCalled();
      expect(chooseCompactItem).not.toHaveBeenCalled();
    },
  );

  it("binds an existing built-in Default workbench to the custom file before applying its launch Item", async () => {
    const { app, file, leaf, setViewState } = setup();
    file.path = "templates/zotlit-profile.default.md";
    const chooseItem = vi.fn();
    const workbench = Object.assign(
      Object.create(ProfileEditorView.prototype),
      { file: null, leaf, chooseItem },
    ) as ProfileEditorView;
    Object.assign(leaf, { view: workbench });
    vi.mocked(findProfileWorkbench).mockResolvedValueOnce(workbench);
    vi.spyOn(app.vault, "getFileByPath").mockReturnValue(file);
    await openNativeProfile(
      app,
      { defaultDocumentPath: file.path, getSource: vi.fn() },
      { customize: true, itemIndexedKey: "MAIN2345" },
    );
    expect(findProfileWorkbench).toHaveBeenCalledWith(app, {
      file: file.path,
      defaultProfile: true,
    });
    expect(setViewState).toHaveBeenCalledWith({
      type: PROFILE_EDITOR_VIEW_TYPE,
      state: {
        file: file.path,
        defaultDraft: false,
        itemIndexedKey: "MAIN2345",
      },
      active: true,
    });
    expect(openProfileWorkbench).toHaveBeenLastCalledWith(app, workbench);
    expect(chooseItem).not.toHaveBeenCalled();
  });

  it("routes explicit Default customization through the ready inspection view", async () => {
    const { app, leaf, setViewState } = setup();
    const customizeDefault = vi.fn(async () => {});
    Object.assign(leaf, {
      view: Object.assign(Object.create(ProfileEditorView.prototype), {
        customizeDefault,
      }),
    });
    await openNativeProfile(
      app,
      {
        defaultDocumentPath: "templates/zotlit-profile.default.md",
        getSource: async () => "Built-in source",
      },
      { customize: true, itemIndexedKey: "0:ABCDEFGH" },
    );
    expect(setViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        state: { file: null, defaultDraft: true, itemIndexedKey: "0:ABCDEFGH" },
      }),
    );
    expect(customizeDefault).toHaveBeenCalledOnce();
  });

  it("opens an existing customized document in the full workbench", async () => {
    const { app, file, leaf } = setup();
    const view = Object.create(
      ProfileEditorView.prototype,
    ) as ProfileEditorView;
    Object.assign(leaf, { view });
    await openNativeProfile(app, file, { customize: true });
    expect(openProfileWorkbench).toHaveBeenCalledWith(app, view);
  });

  it.each(["file", "built-in Default"])(
    "brings the %s editor window forward after its leaf is ready",
    async (target) => {
      const { app, file, leaf, focusWindow } = setup();
      const reveal = Promise.withResolvers<void>();
      const revealLeaf = vi
        .spyOn(app.workspace, "revealLeaf")
        .mockReturnValue(reveal.promise);
      const opening = openNativeProfile(
        app,
        target === "file"
          ? file
          : {
              defaultDocumentPath: "templates/zotlit-profile.default.md",
              getSource: async () => "Configured built-in document",
            },
      );
      await vi.waitFor(() => expect(revealLeaf).toHaveBeenCalledWith(leaf));
      expect(focusWindow).not.toHaveBeenCalled();

      reveal.resolve();
      await opening;

      expect(focusWindow).toHaveBeenCalledOnce();
    },
  );

  it("focuses the supplied editor leaf's window when the leaf is reused", async () => {
    const { app, file, focusWindow } = setup();
    const revealLeaf = vi.spyOn(app.workspace, "revealLeaf");
    const focusExistingWindow = vi.fn();
    const existing = {
      setViewState: vi.fn(async () => {}),
      getContainer: () => ({ focus: focusExistingWindow }),
    } as unknown as WorkspaceLeaf;

    await openProfileEditor(app, file, { leaf: existing });

    expect(revealLeaf).toHaveBeenCalledWith(existing);
    expect(focusExistingWindow).toHaveBeenCalledOnce();
    expect(focusWindow).not.toHaveBeenCalled();
  });

  it("omits the web command when the build gate is off", () => {
    setMockPlatform({ isDesktopApp: true });
    const { deps, plugin, commands, fileMenu } = setup();
    deps.webWorkbenchEnabled = false;

    registerProfileEditor(plugin, deps);

    expect(commands.map(({ id }) => id)).toEqual([
      "customize-profile",
      "open-profile-editor",
    ]);
    expect(fileMenu().items.map(({ title }) => title)).toEqual([
      m.profile_editor_customize(),
      m.profile_editor_open(),
    ]);
  });

  it.each([
    "customize-profile",
    "open-profile-editor",
    "open-profile-web-workbench",
  ])("handles a source read failure from %s", async (id) => {
    setMockPlatform({ isDesktopApp: true });
    const { app, deps, plugin, commands, setViewState } = setup();
    const read = vi
      .spyOn(app.vault, "cachedRead")
      .mockRejectedValue(new Error("File unavailable"));
    registerProfileEditor(plugin, deps);
    expect(
      commands.find((command) => command.id === id)!.checkCallback?.(false),
    ).toBe(true);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(setViewState).not.toHaveBeenCalled();
  });
  it.each(["customize-profile", "open-profile-web-workbench"])(
    "routes a registered Profile through the shared flow from %s",
    async (id) => {
      setMockPlatform({ isDesktopApp: true });
      const { app, file, deps, plugin, commands } = setup();
      const read = vi.spyOn(app.vault, "cachedRead");
      deps.profile = { ...deps.profile, defaultDocumentPath: file.path };
      deps.customize = vi.fn(async () => {});
      registerProfileEditor(plugin, deps);
      expect(
        commands.find((entry) => entry.id === id)!.checkCallback?.(false),
      ).toBe(true);
      await vi.waitFor(() =>
        expect(deps.customize).toHaveBeenCalledWith({
          profileId: "default",
          ...(id === "open-profile-web-workbench"
            ? { destination: "web" }
            : {}),
        }),
      );
      expect(read).not.toHaveBeenCalled();
    },
  );
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
    const command = commands.find(
      (entry) => entry.id === "open-profile-editor",
    )!;
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
      await openNativeProfile(app, file);
      expect(requiresNative(await app.vault.cachedRead(file))).toBe(true);
      expect(setViewState).toHaveBeenCalledOnce();
    },
  );
  it.each(["ask", "web", "native"])(
    "opens the explicit native action with the saved %s preference",
    async (preference) => {
      const { app, loadLocalStorage, file, setViewState } = setup();
      loadLocalStorage.mockReturnValue(preference);
      await openNativeProfile(app, file, { itemIndexedKey: "0:ABCDEFGH" });
      expect(setViewState).toHaveBeenCalledWith({
        type: PROFILE_EDITOR_VIEW_TYPE,
        state: { file: file.path, itemIndexedKey: "0:ABCDEFGH" },
        active: true,
      });
    },
  );
  it.each(["file", "default"])(
    "opens %s without borrowing the active note's Item",
    async (kind) => {
      const { app, file, setViewState } = setup();
      vi.spyOn(app.metadataCache, "getFileCache").mockReturnValue({
        frontmatter: { "zotero-key": "MAIN2345" },
      });
      await openNativeProfile(
        app,
        kind === "file"
          ? file
          : {
              defaultDocumentPath: "templates/zotlit-profile.default.md",
              getSource: async () => "Configured built-in document",
            },
      );
      expect(setViewState).toHaveBeenCalledWith({
        type: PROFILE_EDITOR_VIEW_TYPE,
        state:
          kind === "file"
            ? { file: file.path }
            : { defaultDraft: true, file: null },
        active: true,
      });
    },
  );

  it("opens built-in Default from the effective source without ejecting it", async () => {
    const { app, setViewState } = setup();
    const getSource = vi.fn(async () => "Configured built-in document");
    await openNativeProfile(app, {
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

  it("routes Default to main settings and named profiles to profile settings", () => {
    setMockPlatform({ isDesktopApp: true });
    const { app, plugin, deps, registerView } = setup();
    const tab = {};
    const navigateToSearchResult =
      vi.fn<(request: { tab: object; pagePath: string[] }) => void>();
    const openTabById = vi.fn(() => tab);
    Object.assign(app, {
      setting: {
        open: vi.fn<() => void>(),
        openTabById,
        navigateToSearchResult,
      },
    });
    Object.assign(plugin, { manifest: { id: "zotlit", version: "2.1.3" } });
    Object.assign(deps, { settings: { subscribe: () => () => {} } });
    registerProfileEditor(plugin, deps);
    const create = registerView.mock.calls[0]![1] as (
      leaf: WorkspaceLeaf,
    ) => ProfileEditorView;
    const view = create({ app } as unknown as WorkspaceLeaf);
    view.openSettings!(true);
    expect(openTabById).toHaveBeenCalledWith("zotlit");
    expect(navigateToSearchResult).not.toHaveBeenCalled();
    view.openSettings!(false);
    expect(navigateToSearchResult).toHaveBeenCalledWith({
      tab,
      pagePath: [m.settings_page_profiles()],
    });
    view.scheduler[Symbol.dispose]();
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
