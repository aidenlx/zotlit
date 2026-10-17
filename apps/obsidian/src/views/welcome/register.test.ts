// @vitest-environment happy-dom
import type { App, Command } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerWelcomeView } from "./register";
import type { WelcomeRegistrationDeps } from "./register";

/** Every notice the registration showed, and whether it still shows. */
const notices: { shown: boolean }[] = [];
vi.mock("@/lib/notice", () => ({
  BaseNotice: class {
    static render = () => document.createDocumentFragment();
    readonly entry = { shown: true };
    // Obsidian takes a notice off the page when the researcher dismisses it.
    readonly noticeEl = { isConnected: true };
    constructor() {
      notices.push(this.entry);
    }
    hide() {
      this.entry.shown = false;
    }
  },
}));

vi.mock("@/views/library/view", () => ({
  LIBRARY_VIEW_TYPE: "zotlit-library",
  LibraryView: vi.fn(),
}));

it.each([false, true])(
  "the command shows the banner again over the Library View, reusing an open one (%s)",
  async (existing) => {
    const revealed = Promise.withResolvers<void>();
    const leaf = { setViewState: vi.fn(async () => {}) };
    const workspace = {
      getLeavesOfType: vi.fn(() => (existing ? [leaf] : [])),
      getLeaf: vi.fn(() => leaf),
      revealLeaf: vi.fn(async () => revealed.resolve()),
      setActiveLeaf: vi.fn(),
      on: vi.fn(() => ({})),
      offref: vi.fn(),
    };
    const app = { workspace } as unknown as App;
    const update = vi.fn();
    const commands: Command[] = [];
    registerWelcomeView(
      {
        app,
        register: vi.fn(),
        registerView: vi.fn(),
        addCommand: (command) => {
          commands.push(command);
          return command;
        },
      },
      {
        reads: { on: vi.fn(() => () => {}) },
        queries: { invalidate: vi.fn() },
        settings: { update },
      } as unknown as WelcomeRegistrationDeps,
    );
    commands[0]!.callback!();
    await revealed.promise;

    expect(update).toHaveBeenCalledWith({ "welcome.dismissed": false });
    expect(workspace.getLeaf.mock.calls).toEqual(existing ? [] : [["tab"]]);
    expect(leaf.setViewState.mock.calls).toEqual(
      existing ? [] : [[{ type: "zotlit-library", active: true }]],
    );
    expect(workspace.setActiveLeaf.mock.calls).toEqual(
      existing ? [[leaf, { focus: true }]] : [],
    );
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  },
);

it.each([false, true])(
  "turns a Welcome tab a saved workspace restores into the Library View, or closes it beside an open one (%s)",
  async (existing) => {
    const library = { view: {} };
    const workspace = {
      getLeavesOfType: vi.fn((type: string) =>
        existing && type === "zotlit-library" ? [library] : [],
      ),
      onLayoutReady: (callback: () => void) => callback(),
      on: vi.fn(() => ({})),
      offref: vi.fn(),
    };
    const app = { workspace } as unknown as App;
    const views = new Map<string, (leaf: never) => { onOpen(): unknown }>();
    registerWelcomeView(
      {
        app,
        register: vi.fn(),
        addCommand: (command) => command,
        registerView: (type, factory) => void views.set(type, factory as never),
      },
      {
        reads: { on: vi.fn(() => () => {}) },
        queries: { invalidate: vi.fn() },
        settings: { update: vi.fn() },
      } as unknown as WelcomeRegistrationDeps,
    );
    const changed = Promise.withResolvers<void>();
    const leaf = {
      setViewState: vi.fn(async () => changed.resolve()),
      detach: vi.fn(() => changed.resolve()),
    };
    const view = views.get("zotlit-welcome")!(leaf as never);
    await view.onOpen();
    await changed.promise;
    expect(leaf.detach.mock.calls).toHaveLength(existing ? 1 : 0);
    expect(leaf.setViewState.mock.calls).toEqual(
      existing ? [] : [[{ type: "zotlit-library" }]],
    );
  },
);

describe("the notice of a Zotero data folder this device does not have", () => {
  function setup(libraryOpen = false) {
    const reads = createNanoEvents<{
      "db-file-missing": () => void;
      changed: () => void;
    }>();
    const app = {
      workspace: {
        getLeavesOfType: vi.fn((type: string) =>
          libraryOpen && type === "zotlit-library" ? [{}] : [],
        ),
        on: vi.fn(() => ({})),
        offref: vi.fn(),
      },
    } as unknown as App;
    registerWelcomeView(
      {
        app,
        register: vi.fn(),
        addCommand: (command) => command,
        registerView: vi.fn(),
      },
      {
        reads: { on: reads.on.bind(reads) },
        queries: { invalidate: vi.fn() },
        settings: { update: vi.fn() },
      } as unknown as WelcomeRegistrationDeps,
    );
    return reads;
  }

  beforeEach(() => {
    notices.length = 0;
  });

  it("shows one notice however often the signal comes, and hides it once Zotero reads again", () => {
    const reads = setup();
    reads.emit("db-file-missing");
    reads.emit("db-file-missing");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.shown).toBe(true);
    reads.emit("changed");
    expect(notices[0]!.shown).toBe(false);
    // A later miss says so again, with one notice.
    reads.emit("db-file-missing");
    expect(notices.filter((notice) => notice.shown)).toHaveLength(1);
  });

  it("shows no notice while a Library View is open, whose not-found card says the same", () => {
    const reads = setup(true);
    reads.emit("db-file-missing");
    expect(notices).toHaveLength(0);
  });
});
