// @vitest-environment happy-dom
import { Menu, resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { TFile } from "obsidian";
import type { App, Command, Plugin, WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import {
  findWorkbenchLayout,
  openWorkbenchLayout,
} from "@/views/note-preview/register";

import { profileCustomization, saveProfileCustomization } from "./preferences";
import {
  openNativeProfile,
  requiresNative,
  openTemplateWorkbench,
  registerTemplateWorkbenchView,
} from "./register";
import type { TemplateWorkbenchDeps } from "./view";
import { TEMPLATE_WORKBENCH_VIEW_TYPE, TemplateWorkbenchView } from "./view";

vi.mock("@/views/note-preview/register", () => ({
  openWorkbenchLayout: vi.fn(async () => {}),
  findWorkbenchLayout: vi.fn(async () => null),
}));

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
afterEach(() => {
  resetMockPlatform();
  vi.mocked(findWorkbenchLayout).mockReset().mockResolvedValue(null);
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
  } as unknown as TemplateWorkbenchDeps &
    Parameters<typeof registerTemplateWorkbenchView>[1];
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

describe("Template Workbench entry points", () => {
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
        Object.create(TemplateWorkbenchView.prototype),
        { file, leaf: compactLeaf, chooseItem: chooseCompactItem },
      ) as TemplateWorkbenchView;
      Object.assign(compactLeaf, { view: compact });
      const workbenchSetState = vi.fn(async () => {});
      const workbenchLeaf = {
        setViewState: workbenchSetState,
        getContainer: () => ({ focus: vi.fn() }),
      } as unknown as WorkspaceLeaf;
      const workbench = Object.assign(
        Object.create(TemplateWorkbenchView.prototype),
        { file, leaf: workbenchLeaf, chooseItem: chooseWorkbenchItem },
      ) as TemplateWorkbenchView;
      Object.assign(workbenchLeaf, { view: workbench });
      vi.spyOn(app.workspace, "getLeavesOfType").mockReturnValue([
        compactLeaf,
        workbenchLeaf,
      ]);
      vi.mocked(findWorkbenchLayout).mockResolvedValueOnce(workbench);
      await openNativeProfile(app, file, {
        customize: true,
        itemIndexedKey: "MAIN2345",
      });
      expect(findWorkbenchLayout).toHaveBeenCalledWith(app, {
        file: file.path,
        defaultProfile: false,
      });
      expect(workbenchSetState).toHaveBeenCalledWith({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: { file: file.path, itemIndexedKey: "MAIN2345" },
        active: true,
      });
      expect(compactSetState).not.toHaveBeenCalled();
      expect(openWorkbenchLayout).toHaveBeenLastCalledWith(app, workbench);
      expect(chooseWorkbenchItem).not.toHaveBeenCalled();
      expect(chooseCompactItem).not.toHaveBeenCalled();
    },
  );

  it("binds an existing built-in Default workbench to the custom file before applying its launch Item", async () => {
    const { app, file, leaf, setViewState } = setup();
    file.path = "templates/zotlit-profile.default.md";
    const chooseItem = vi.fn();
    const workbench = Object.assign(
      Object.create(TemplateWorkbenchView.prototype),
      { file: null, leaf, chooseItem },
    ) as TemplateWorkbenchView;
    Object.assign(leaf, { view: workbench });
    vi.mocked(findWorkbenchLayout).mockResolvedValueOnce(workbench);
    vi.spyOn(app.vault, "getFileByPath").mockReturnValue(file);
    await openNativeProfile(
      app,
      { defaultDocumentPath: file.path, getSource: vi.fn() },
      { customize: true, itemIndexedKey: "MAIN2345" },
    );
    expect(findWorkbenchLayout).toHaveBeenCalledWith(app, {
      file: file.path,
      defaultProfile: true,
    });
    expect(setViewState).toHaveBeenCalledWith({
      type: TEMPLATE_WORKBENCH_VIEW_TYPE,
      state: {
        file: file.path,
        defaultDraft: false,
        itemIndexedKey: "MAIN2345",
      },
      active: true,
    });
    expect(openWorkbenchLayout).toHaveBeenLastCalledWith(app, workbench);
    expect(chooseItem).not.toHaveBeenCalled();
  });

  it("routes explicit Default customization through the ready inspection view", async () => {
    const { app, leaf, setViewState } = setup();
    const customizeDefault = vi.fn(async () => {});
    Object.assign(leaf, {
      view: Object.assign(Object.create(TemplateWorkbenchView.prototype), {
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
      TemplateWorkbenchView.prototype,
    ) as TemplateWorkbenchView;
    Object.assign(leaf, { view });
    await openNativeProfile(app, file, { customize: true });
    expect(openWorkbenchLayout).toHaveBeenCalledWith(app, view);
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

    await openTemplateWorkbench(app, file, { leaf: existing });

    expect(revealLeaf).toHaveBeenCalledWith(existing);
    expect(focusExistingWindow).toHaveBeenCalledOnce();
    expect(focusWindow).not.toHaveBeenCalled();
  });

  it("omits the web command when the build gate is off", () => {
    setMockPlatform({ isDesktopApp: true });
    const { deps, plugin, commands, fileMenu } = setup();
    deps.webWorkbenchEnabled = false;

    registerTemplateWorkbenchView(plugin, deps);

    expect(commands.map(({ id }) => id)).toEqual([
      "customize-profile",
      "open-template-workbench-view",
    ]);
    expect(fileMenu().items.map(({ title }) => title)).toEqual([
      m.template_workbench_customize(),
      m.template_workbench_open(),
    ]);
  });

  it.each([
    "customize-profile",
    "open-template-workbench-view",
    "open-profile-web-workbench",
  ])("handles a source read failure from %s", async (id) => {
    setMockPlatform({ isDesktopApp: true });
    const { app, deps, plugin, commands, setViewState } = setup();
    const read = vi
      .spyOn(app.vault, "cachedRead")
      .mockRejectedValue(new Error("File unavailable"));
    registerTemplateWorkbenchView(plugin, deps);
    expect(
      commands.find((command) => command.id === id)!.checkCallback?.(false),
    ).toBe(true);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(setViewState).not.toHaveBeenCalled();
  });
  it.each([
    "customize-profile",
    "open-template-workbench-view",
    "open-profile-web-workbench",
  ])(
    "routes a registered Profile through the shared flow from %s",
    async (id) => {
      setMockPlatform({ isDesktopApp: true });
      const { app, file, deps, plugin, commands } = setup();
      const read = vi.spyOn(app.vault, "cachedRead");
      deps.profile = { ...deps.profile, defaultDocumentPath: file.path };
      deps.customize = vi.fn(async () => {});
      registerTemplateWorkbenchView(plugin, deps);
      expect(
        commands.find((entry) => entry.id === id)!.checkCallback?.(false),
      ).toBe(true);
      await vi.waitFor(() =>
        expect(deps.customize).toHaveBeenCalledWith({
          profileId: "default",
          ...(id === "open-profile-web-workbench"
            ? { destination: "web" }
            : id === "open-template-workbench-view"
              ? { destination: "native" }
              : {}),
        }),
      );
      expect(read).not.toHaveBeenCalled();
    },
  );
  it("opens the Citation Template from the command, the file menu, and no Profile flow", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { file, deps, plugin, commands, fileMenu, setViewState } = setup();
    file.path = "templates/zotlit-citation.md";
    file.basename = "zotlit-citation";
    deps.customize = vi.fn(async () => {});
    registerTemplateWorkbenchView(plugin, deps);

    const command = commands.find(
      (entry) => entry.id === "open-template-workbench-view",
    )!;
    expect(command.checkCallback?.(true)).toBe(true);
    expect(command.checkCallback?.(false)).toBe(true);
    await vi.waitFor(() =>
      expect(setViewState).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TEMPLATE_WORKBENCH_VIEW_TYPE,
          state: expect.objectContaining({ file: file.path }),
        }),
      ),
    );
    // The file menu offers the one action, on the same route.
    expect(fileMenu().items.map(({ title }) => title)).toEqual([
      m.template_workbench_open(),
    ]);
    expect(deps.customize).not.toHaveBeenCalled();
  });
  it("opens a Shared Partial on the same plain-document route", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { file, deps, plugin, commands, fileMenu, setViewState } = setup();
    file.path = "templates/zotlit-partial.authors.md";
    file.basename = "zotlit-partial.authors";
    deps.customize = vi.fn(async () => {});
    registerTemplateWorkbenchView(plugin, deps);

    const command = commands.find(
      (entry) => entry.id === "open-template-workbench-view",
    )!;
    expect(command.checkCallback?.(false)).toBe(true);
    await vi.waitFor(() =>
      expect(setViewState).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TEMPLATE_WORKBENCH_VIEW_TYPE,
          state: expect.objectContaining({ file: file.path }),
        }),
      ),
    );
    expect(fileMenu().items.map(({ title }) => title)).toEqual([
      m.template_workbench_open(),
    ]);
    expect(deps.customize).not.toHaveBeenCalled();
  });
  it("routes the file menu's native editor action through the shared flow", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { file, deps, plugin, fileMenu } = setup();
    deps.profile = { ...deps.profile, defaultDocumentPath: file.path };
    deps.customize = vi.fn(async () => {});
    registerTemplateWorkbenchView(plugin, deps);

    fileMenu()
      .items.find((item) => item.title === m.template_workbench_open())!
      .click();

    await vi.waitFor(() =>
      expect(deps.customize).toHaveBeenCalledExactlyOnceWith({
        profileId: "default",
        destination: "native",
      }),
    );
  });
  it("opens the current Literature Note's resolved Default with that paper selected", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { app, file, deps, plugin, commands } = setup();
    deps.customize = vi.fn(async () => {});
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
    registerTemplateWorkbenchView(plugin, deps);
    const command = commands.find(
      (entry) => entry.id === "open-template-workbench-view",
    )!;
    expect(command.checkCallback?.(false)).toBe(true);
    await vi.waitFor(() =>
      expect(deps.customize).toHaveBeenCalledWith({
        profileId: "default",
        destination: "native",
        item: { key: "PAPER234", title: null },
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
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
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
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
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
      type: TEMPLATE_WORKBENCH_VIEW_TYPE,
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
    registerTemplateWorkbenchView(plugin, deps);
    expect(registerView).toHaveBeenCalledWith(
      TEMPLATE_WORKBENCH_VIEW_TYPE,
      expect.any(Function),
    );
    expect(commands[0]!.checkCallback?.(true)).toBe(true);
    await openTemplateWorkbench(app, file);
    expect(setViewState).toHaveBeenCalledWith({
      type: TEMPLATE_WORKBENCH_VIEW_TYPE,
      state: { file: file.path },
      active: true,
    });
  });

  it("opens the requested Match tab in Basic mode", async () => {
    const { app, file, setViewState } = setup();
    await openTemplateWorkbench(app, file, { tab: "match" });
    expect(setViewState).toHaveBeenCalledWith({
      type: TEMPLATE_WORKBENCH_VIEW_TYPE,
      state: { file: file.path, tab: "match", advanced: false },
      active: true,
    });
  });

  it("keeps registration desktop-only", () => {
    setMockPlatform({ isDesktopApp: false });
    const { plugin, deps, registerView } = setup();
    registerTemplateWorkbenchView(plugin, deps);
    expect(registerView).not.toHaveBeenCalled();
  });
});
