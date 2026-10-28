// @vitest-environment happy-dom
import { Menu, resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { Effect } from "effect";
import { MarkdownView, TFile } from "obsidian";
import type {
  App,
  Command,
  EventRef,
  Plugin,
  ViewState,
  WorkspaceLeaf,
} from "obsidian";
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { openTestBridge } from "@/lib/__fixtures__/effect-bridge";
import { testNotifier } from "@/lib/__fixtures__/notifier";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { registerFileMenu } from "@/services/file-menu";
import type {
  CustomizeAction,
  DefaultProfileTarget,
} from "@/services/local-bridge/customize";
import type { Profile } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import {
  findWorkbenchLayout,
  openWorkbenchLayout,
} from "@/views/note-preview/layout";

import { makeWorkbenchHost, workbenchActionContext } from "./__fixtures__";
import type { WorkbenchHostDeps } from "./__fixtures__";

type RegistrationHostDeps = WorkbenchHostDeps & {
  webWorkbenchEnabled: boolean;
  customize: CustomizeAction;
  profile: Profile["Service"];
};
/** The Default Profile as the plugin runtime hands it over, read from `profile`. */
const defaultTarget = (
  profile: Pick<Profile["Service"], "defaultDocumentPath" | "getSource">,
): DefaultProfileTarget => ({
  get defaultDocumentPath() {
    return Effect.runSync(profile.defaultDocumentPath);
  },
  getSource: (selector) => Effect.runPromise(profile.getSource(selector)),
});

import type { WorkbenchActionServices } from "./actions";
import { openNativeProfile, openTemplateWorkbench } from "./open";
import { profileCustomization, saveProfileCustomization } from "./preferences";
import {
  registerTemplateWorkbenchView,
  templateWorkbenchFileMenu,
} from "./register";
import { TEMPLATE_WORKBENCH_VIEW_TYPE, TemplateWorkbenchView } from "./view";

// The real leaf edges stand in: the layout module imports this view.
vi.mock("@/views/note-preview/layout", () => ({
  setLeafState: (leaf: WorkspaceLeaf, state: ViewState) =>
    Effect.tryPromise(() => leaf.setViewState(state)),
  WORKBENCH_WINDOW: { width: 1440, height: 900 },
  openWorkbenchLayout: vi.fn(() => Effect.void),
  findWorkbenchLayout: vi.fn(() => Effect.succeed(null)),
}));

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
const setOriginatingNote = vi.fn<
  (file: TFile | null) => Effect.Effect<string | null>
>(() => Effect.succeed(null));
beforeEach(() => {
  vi.spyOn(
    TemplateWorkbenchView.prototype,
    "setOriginatingNote",
  ).mockImplementation(setOriginatingNote);
});
afterEach(() => {
  vi.restoreAllMocks();
  resetMockPlatform();
  vi.mocked(findWorkbenchLayout)
    .mockReset()
    .mockReturnValue(Effect.succeed(null));
});

/** The workspace and vault a launch reads, over the test's App. */
function appContext(app: App) {
  return workbenchActionContext(testNotifier().service, {
    vault: {
      cachedRead: (file) => Effect.promise(() => app.vault.cachedRead(file)),
      getFileByPath: (path) => Effect.sync(() => app.vault.getFileByPath(path)),
    },
    workspace: {
      leavesOfType: (type) =>
        Effect.sync(() => app.workspace.getLeavesOfType(type)),
      getLeaf: (pane) => Effect.sync(() => app.workspace.getLeaf(pane)),
      openPopoutLeaf: (size) =>
        Effect.sync(() => app.workspace.openPopoutLeaf({ size })),
      revealLeaf: (leaf) =>
        Effect.promise(async () => app.workspace.revealLeaf(leaf)),
    },
  });
}

/** Run the launch `open` over the workspace and vault of `app`. */
function launch<A, E>(
  app: App,
  open: Effect.Effect<A, E, WorkbenchActionServices>,
): Promise<A> {
  return Effect.runPromise(open.pipe(Effect.provideContext(appContext(app))));
}

/** A bridge over an empty runtime, closed when the test ends. */
function testBridge() {
  const bridge = openTestBridge();
  onTestFinished(() => bridge[Symbol.asyncDispose]());
  return bridge;
}

type FileMenuHandler = (
  menu: Menu,
  file: TFile,
  ...origin: [source: string, leaf?: WorkspaceLeaf]
) => void;

function setup() {
  const file = new TFile();
  file.path = "templates/zotlit-profile.paper.md";
  file.basename = "zotlit-profile.paper";
  file.extension = "md";
  const setViewState = vi.fn(async () => {});
  const focusWindow = vi.fn();
  const container = stubService<App["workspace"]["rootSplit"]>(
    "WorkspaceContainer",
    { focus: focusWindow },
  );
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    updateHeader: vi.fn(),
    setViewState,
    getContainer: () => container,
    view: stubService<WorkspaceLeaf["view"]>("View", {}),
  });
  const fileMenuHandlers: FileMenuHandler[] = [];
  const workspaceOn = vi.fn();
  workspaceOn.mockImplementation(
    (event: string, handler: FileMenuHandler): EventRef => {
      if (event === "file-menu") fileMenuHandlers.push(handler);
      return stubService<EventRef>("EventRef", {});
    },
  );
  const workspace = stubService<App["workspace"]>("Workspace", {
    activeLeaf: null,
    getActiveFile: () => file,
    getLeavesOfType: () => [],
    getLeaf: vi.fn(() => leaf),
    openPopoutLeaf: vi.fn(() => leaf),
    revealLeaf: vi.fn(),
    on: workspaceOn,
    onLayoutReady: vi.fn(),
  });
  const loadLocalStorage = vi.fn<() => unknown>(() => null);
  const saveLocalStorage = vi.fn();
  const app = stubService<App>("App", {
    workspace,
    loadLocalStorage,
    saveLocalStorage,
    vault: stubService<App["vault"]>("Vault", {
      cachedRead: vi.fn(async () => "A document"),
      getFileByPath: vi.fn(() => null),
    }),
    metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
      getFileCache: () => null,
    }),
  });
  const commands: Command[] = [];
  const registerView = vi.fn();
  const plugin = stubService<Plugin>("Plugin", {
    app,
    manifest: stubService<Plugin["manifest"]>("PluginManifest", {
      version: "2.1.3",
    }),
    registerView,
    addCommand: (command: Command) => {
      commands.push(command);
      return command;
    },
    registerEvent: vi.fn(),
    register: vi.fn(),
  });
  const deps = stubService<RegistrationHostDeps>("TemplateWorkbenchDeps", {
    runtime: testRuntime(),
    webWorkbenchEnabled: true,
    // The classifier reads a filename only inside the template folder.
    settings: stubService<RegistrationHostDeps["settings"]>("PluginSettings", {
      current: Effect.succeed({
        ...defaults,
        "template.folder": "templates",
      }),
    }),
    bridge: stubService<RegistrationHostDeps["bridge"]>("EffectBridge", {
      runSync: Effect.runSync,
    }),
    profile: stubService<RegistrationHostDeps["profile"]>("Profile", {
      profiles: Effect.succeed([]),
      defaultDocumentPath: Effect.succeed(
        "templates/zotlit-profile.default.md",
      ),
    }),
  });
  return {
    app,
    workspace,
    loadLocalStorage,
    saveLocalStorage,
    file,
    leaf,
    plugin,
    deps,
    commands,
    fileMenu: (menuLeaf?: WorkspaceLeaf) => {
      const menu = new Menu();
      for (const handler of fileMenuHandlers)
        handler(menu, file, "more-options", menuLeaf);
      return menu;
    },
    registerView,
    setViewState,
    focusWindow,
  };
}

/** Register the view, and place its file-menu entries as the plugin does. */
function register(plugin: Plugin, deps: RegistrationHostDeps): void {
  const options = {
    ...makeWorkbenchHost(deps).deps,
    customize: "customize" in deps ? deps.customize : async () => {},
    bridge: testBridge(),
    context: appContext(plugin.app),
    webWorkbenchEnabled: deps.webWorkbenchEnabled,
    defaultProfile: defaultTarget(deps.profile),
  };
  registerTemplateWorkbenchView(plugin, options);
  registerFileMenu(plugin, [templateWorkbenchFileMenu(plugin.app, options)]);
}

describe("Template Workbench entry points", () => {
  it.each(["file", "built-in Default"])(
    "opens a new %s Customize editor directly in a popout",
    async (target) => {
      const { app, workspace, file, setViewState } = setup();
      await launch(
        app,
        openNativeProfile(
          target === "file"
            ? file
            : defaultTarget({
                defaultDocumentPath: Effect.succeed(
                  "templates/zotlit-profile.default.md",
                ),
                getSource: () => Effect.succeed("Built-in source"),
              }),
          { customize: true },
        ),
      );

      expect(workspace.getLeaf).not.toHaveBeenCalled();
      expect(workspace.openPopoutLeaf).toHaveBeenCalledWith({
        size: { width: 1440, height: 900 },
      });
      expect(setViewState).toHaveBeenCalledOnce();
    },
  );

  it.each(["named", "copied-default", "default"])(
    "applies a Customize launch Item to the existing %s workbench and leaves its compact editor unchanged",
    async (kind) => {
      const {
        app,
        workspace,
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
      const workbenchContainer = stubService<App["workspace"]["rootSplit"]>(
        "WorkspaceContainer",
        { focus: vi.fn() },
      );
      const workbenchLeaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        setViewState: workbenchSetState,
        getContainer: () => workbenchContainer,
      });
      const workbench = Object.assign(
        Object.create(TemplateWorkbenchView.prototype),
        { file, leaf: workbenchLeaf, chooseItem: chooseWorkbenchItem },
      ) as TemplateWorkbenchView;
      Object.assign(workbenchLeaf, { view: workbench });
      vi.spyOn(app.workspace, "getLeavesOfType").mockReturnValue([
        compactLeaf,
        workbenchLeaf,
      ]);
      vi.mocked(findWorkbenchLayout).mockReturnValueOnce(
        Effect.succeed(workbench),
      );
      await launch(
        app,
        openNativeProfile(file, {
          customize: true,
          itemIndexedKey: "MAIN2345",
          originatingNote: file,
        }),
      );
      expect(findWorkbenchLayout).toHaveBeenCalledWith({
        file: file.path,
        defaultProfile: false,
      });
      expect(workbenchSetState).toHaveBeenCalledWith({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: { file: file.path, itemIndexedKey: "MAIN2345" },
        active: true,
      });
      expect(compactSetState).not.toHaveBeenCalled();
      expect(workspace.openPopoutLeaf).not.toHaveBeenCalled();
      expect(openWorkbenchLayout).toHaveBeenLastCalledWith(workbench);
      expect(setOriginatingNote).toHaveBeenLastCalledWith(file);
      expect(chooseWorkbenchItem).not.toHaveBeenCalled();
      expect(chooseCompactItem).not.toHaveBeenCalled();
    },
  );

  it("applies two quick Customize launches into one workbench in the order they came", async () => {
    const { app, file, leaf } = setup();
    const workbench = Object.assign(
      Object.create(TemplateWorkbenchView.prototype),
      { file, leaf },
    ) as TemplateWorkbenchView;
    Object.assign(leaf, { view: workbench });
    vi.mocked(findWorkbenchLayout).mockReturnValue(Effect.succeed(workbench));
    // As Obsidian 1.14.5's `WorkspaceLeaf.setViewState`: a call while the
    // leaf still applies an earlier state returns at once and applies nothing.
    const firstApplied = Promise.withResolvers<void>();
    const applied: unknown[] = [];
    let working = false;
    const setViewState = vi.fn(async ({ state }: ViewState) => {
      if (working) return;
      working = true;
      try {
        if (applied.length === 0) await firstApplied.promise;
        applied.push(state?.itemIndexedKey);
      } finally {
        working = false;
      }
    });
    Object.assign(leaf, { setViewState });
    const note = (basename: string) =>
      Object.assign(new TFile(), {
        path: `literatures/${basename}.md`,
        basename,
      });
    const rougier = note("rougierTenSimpleRules2014");
    const witt = note("wittNebulinRegulatesThin2006");
    setOriginatingNote.mockClear();
    const launches = launch(
      app,
      Effect.all(
        [
          openTemplateWorkbench(file, {
            customize: true,
            itemIndexedKey: "RUGIER24",
            originatingNote: rougier,
          }),
          openTemplateWorkbench(file, {
            customize: true,
            itemIndexedKey: "WTTTNB26",
            originatingNote: witt,
          }),
        ],
        { concurrency: "unbounded" },
      ),
    );
    await vi.waitFor(() => expect(setViewState).toHaveBeenCalled());
    firstApplied.resolve();
    await launches;
    expect(applied).toEqual(["RUGIER24", "WTTTNB26"]);
    expect(setOriginatingNote.mock.calls).toEqual([[rougier], [witt]]);
  });

  it("binds an existing built-in Default workbench to the custom file before applying its launch Item", async () => {
    const { app, file, leaf, setViewState } = setup();
    file.path = "templates/zotlit-profile.default.md";
    const chooseItem = vi.fn();
    const workbench = Object.assign(
      Object.create(TemplateWorkbenchView.prototype),
      { file: null, leaf, chooseItem },
    ) as TemplateWorkbenchView;
    Object.assign(leaf, { view: workbench });
    vi.mocked(findWorkbenchLayout).mockReturnValueOnce(
      Effect.succeed(workbench),
    );
    vi.spyOn(app.vault, "getFileByPath").mockReturnValue(file);
    await launch(
      app,
      openNativeProfile(
        defaultTarget({
          defaultDocumentPath: Effect.succeed(file.path),
          getSource: vi.fn(),
        }),
        { customize: true, itemIndexedKey: "MAIN2345" },
      ),
    );
    expect(findWorkbenchLayout).toHaveBeenCalledWith({
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
    expect(openWorkbenchLayout).toHaveBeenLastCalledWith(workbench);
    expect(chooseItem).not.toHaveBeenCalled();
  });

  it("routes explicit Default customization through the ready inspection view", async () => {
    const { app, leaf, setViewState } = setup();
    const customizeDefault = vi.fn(() => Effect.void);
    Object.assign(leaf, {
      view: Object.assign(Object.create(TemplateWorkbenchView.prototype), {
        customizeDefault,
      }),
    });
    await launch(
      app,
      openNativeProfile(
        defaultTarget({
          defaultDocumentPath: Effect.succeed(
            "templates/zotlit-profile.default.md",
          ),
          getSource: () => Effect.succeed("Built-in source"),
        }),
        { customize: true, itemIndexedKey: "0:ABCDEFGH" },
      ),
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
    await launch(app, openNativeProfile(file, { customize: true }));
    expect(openWorkbenchLayout).toHaveBeenCalledWith(view);
  });

  it.each(["file", "built-in Default"])(
    "brings the %s editor window forward after its leaf is ready",
    async (target) => {
      const { app, workspace, file, leaf, focusWindow } = setup();
      const reveal = Promise.withResolvers<void>();
      const revealLeaf = vi
        .spyOn(app.workspace, "revealLeaf")
        .mockReturnValue(reveal.promise);
      const opening = launch(
        app,
        openNativeProfile(
          target === "file"
            ? file
            : defaultTarget({
                defaultDocumentPath: Effect.succeed(
                  "templates/zotlit-profile.default.md",
                ),
                getSource: () => Effect.succeed("Configured built-in document"),
              }),
        ),
      );
      await vi.waitFor(() => expect(revealLeaf).toHaveBeenCalledWith(leaf));
      expect(focusWindow).not.toHaveBeenCalled();

      reveal.resolve();
      await opening;

      expect(focusWindow).toHaveBeenCalledOnce();
      expect(workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(workspace.openPopoutLeaf).not.toHaveBeenCalled();
    },
  );

  it("focuses the supplied editor leaf's window when the leaf is reused", async () => {
    const { app, file, focusWindow } = setup();
    const revealLeaf = vi.spyOn(app.workspace, "revealLeaf");
    const focusExistingWindow = vi.fn();
    const existingContainer = stubService<App["workspace"]["rootSplit"]>(
      "WorkspaceContainer",
      { focus: focusExistingWindow },
    );
    const existing = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      updateHeader: vi.fn(),
      view: stubService<WorkspaceLeaf["view"]>("View", {}),
      setViewState: vi.fn(async () => {}),
      getContainer: () => existingContainer,
    });

    await launch(app, openTemplateWorkbench(file, { leaf: existing }));

    expect(revealLeaf).toHaveBeenCalledWith(existing);
    expect(focusExistingWindow).toHaveBeenCalledOnce();
    expect(focusWindow).not.toHaveBeenCalled();
  });

  it("omits the web command when the build gate is off", () => {
    setMockPlatform({ isDesktopApp: true });
    const { deps, plugin, commands, fileMenu } = setup();
    deps.webWorkbenchEnabled = false;

    register(plugin, deps);

    expect(commands.map(({ id }) => id)).toEqual([
      "customize-profile",
      "open-template-workbench-view",
    ]);
    expect(commands.map(({ name }) => name)).toEqual([
      m.template_workbench_open_layout(),
      m.template_workbench_open(),
    ]);
    expect(fileMenu().items.map(({ title }) => title)).toEqual([
      m.template_workbench_open_layout(),
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
    register(plugin, deps);
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
      deps.profile = {
        ...deps.profile,
        defaultDocumentPath: Effect.succeed(file.path),
      };
      deps.customize = vi.fn(async () => {});
      register(plugin, deps);
      expect(
        commands.find((entry) => entry.id === id)!.checkCallback?.(false),
      ).toBe(true);
      await vi.waitFor(() =>
        expect(deps.customize).toHaveBeenCalledWith({
          profileId: "default",
          ...(id === "open-profile-web-workbench"
            ? { destination: "web" }
            : { destination: "native" }),
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
    register(plugin, deps);

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
    register(plugin, deps);

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
  it("routes Open template workbench through the shared flow", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { file, deps, plugin, fileMenu } = setup();
    deps.profile = {
      ...deps.profile,
      defaultDocumentPath: Effect.succeed(file.path),
    };
    deps.customize = vi.fn(async () => {});
    register(plugin, deps);

    fileMenu()
      .items.find((item) => item.title === m.template_workbench_open_layout())!
      .click();

    await vi.waitFor(() =>
      expect(deps.customize).toHaveBeenCalledExactlyOnceWith({
        profileId: "default",
        destination: "native",
      }),
    );
  });
  it("switches the active Markdown view to the Template Workbench view", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { app, file, leaf, deps, plugin, commands, setViewState } = setup();
    const markdownView = Object.assign(new MarkdownView(leaf), { file, leaf });
    Object.assign(leaf, { view: markdownView });
    app.workspace.activeLeaf = leaf;
    deps.profile = {
      ...deps.profile,
      profiles: Effect.succeed([{ id: "paper", path: file.path }]),
    } as unknown as typeof deps.profile;
    deps.customize = vi.fn(async () => {});
    register(plugin, deps);

    const command = commands.find(
      (entry) => entry.id === "open-template-workbench-view",
    )!;
    expect(command.checkCallback?.(false)).toBe(true);

    await vi.waitFor(() =>
      expect(setViewState).toHaveBeenCalledWith({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: { file: file.path },
        active: true,
      }),
    );
    expect(deps.customize).not.toHaveBeenCalled();
    expect(openWorkbenchLayout).not.toHaveBeenCalled();
  });
  it("switches the file menu's active Markdown view to the Template Workbench view", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { app, file, leaf, deps, plugin, fileMenu, setViewState } = setup();
    const markdownView = Object.assign(new MarkdownView(leaf), { file, leaf });
    Object.assign(leaf, { view: markdownView });
    app.workspace.activeLeaf = leaf;
    deps.profile = {
      ...deps.profile,
      profiles: Effect.succeed([{ id: "paper", path: file.path }]),
    } as unknown as typeof deps.profile;
    deps.customize = vi.fn(async () => {});
    register(plugin, deps);

    fileMenu()
      .items.find((item) => item.title === m.template_workbench_open())!
      .click();

    await vi.waitFor(() =>
      expect(setViewState).toHaveBeenCalledWith({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: { file: file.path },
        active: true,
      }),
    );
    expect(deps.customize).not.toHaveBeenCalled();
    expect(openWorkbenchLayout).not.toHaveBeenCalled();
  });
  it("opens the current Literature Note's resolved Default with that paper selected", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { app, file, deps, plugin, commands, setViewState } = setup();
    deps.customize = vi.fn(async () => {});
    file.path = "Literature/Figures.md";
    file.basename = "Figures";
    // The note's Profile resolves through the vault, by path.
    Object.assign(deps, { app });
    vi.spyOn(app.vault, "getFileByPath").mockImplementation((path) =>
      path === file.path ? file : null,
    );
    vi.spyOn(app.metadataCache, "getFileCache").mockReturnValue({
      frontmatter: { "zotero-key": "PAPER234" },
    });
    deps.profile.profileOf = vi.fn(() =>
      Effect.succeed({
        ok: true,
        profile: { selector: "default" },
      } as Effect.Success<ReturnType<typeof deps.profile.profileOf>>),
    );
    deps.profile.getSource = vi.fn(() => Effect.succeed("Configured Default"));
    register(plugin, deps);
    const command = commands.find(
      (entry) => entry.id === "open-template-workbench-view",
    )!;
    expect(command.checkCallback?.(false)).toBe(true);
    await vi.waitFor(() =>
      expect(setViewState).toHaveBeenCalledWith({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: {
          defaultDraft: true,
          file: null,
          itemIndexedKey: "PAPER234",
        },
        active: true,
      }),
    );
    expect(deps.customize).not.toHaveBeenCalled();
  });
  it.each([
    "language: eta",
    "language: liquid\nfrontmatter:\n  - key: title\n    js: zt.title\n    merge: replace",
  ])(
    "opens an advanced Profile natively, which needs the native editor: %s",
    async (manifest) => {
      const { app, file, setViewState } = setup();
      const source = `---\nid: paper\nname: Paper\nversion: 1.0.0\ncontract: 2\n${manifest}\nfilename: paper\n---\nBody\n--- zotlit:annotation ---\nAnnotation\n`;
      vi.spyOn(app.vault, "cachedRead").mockResolvedValue(source);
      expect(await launch(app, openNativeProfile(file))).toEqual({
        nativeRequired: true,
        unavailableNote: null,
      });
      expect(setViewState).toHaveBeenCalledOnce();
    },
  );
  it.each([true, false])(
    "asks for the native editor only when the open explains it: %s",
    async (explainUnsupported) => {
      const { app, file } = setup();
      vi.spyOn(app.vault, "cachedRead").mockResolvedValue(
        "---\nid: paper\nname: Paper\nversion: 1.0.0\ncontract: 2\nlanguage: eta\nfilename: paper\n---\nBody\n--- zotlit:annotation ---\nAnnotation\n",
      );
      expect(
        await launch(app, openTemplateWorkbench(file, { explainUnsupported })),
      ).toEqual({ nativeRequired: explainUnsupported, unavailableNote: null });
    },
  );
  it.each(["ask", "web"])(
    "opens the explicit native action with the saved %s preference",
    async (preference) => {
      const { app, loadLocalStorage, file, setViewState } = setup();
      loadLocalStorage.mockReturnValue(preference);
      await launch(
        app,
        openNativeProfile(file, { itemIndexedKey: "0:ABCDEFGH" }),
      );
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
      await launch(
        app,
        openNativeProfile(
          kind === "file"
            ? file
            : defaultTarget({
                defaultDocumentPath: Effect.succeed(
                  "templates/zotlit-profile.default.md",
                ),
                getSource: () => Effect.succeed("Configured built-in document"),
              }),
        ),
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
    const getSource = vi.fn(() =>
      Effect.succeed("Configured built-in document"),
    );
    await launch(
      app,
      openNativeProfile(
        defaultTarget({
          defaultDocumentPath: Effect.succeed(
            "templates/zotlit-profile.default.md",
          ),
          getSource,
        }),
      ),
    );
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
  it("opens the requested Match tab in Basic mode", async () => {
    const { app, file, setViewState } = setup();
    await launch(app, openTemplateWorkbench(file, { tab: "match" }));
    expect(setViewState).toHaveBeenCalledWith({
      type: TEMPLATE_WORKBENCH_VIEW_TYPE,
      state: { file: file.path, tab: "match", advanced: false },
      active: true,
    });
  });

  it("keeps registration desktop-only", () => {
    setMockPlatform({ isDesktopApp: false });
    const { plugin, deps, registerView } = setup();
    register(plugin, deps);
    expect(registerView).not.toHaveBeenCalled();
  });
});
