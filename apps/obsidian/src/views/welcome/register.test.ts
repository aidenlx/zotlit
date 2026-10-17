// @vitest-environment happy-dom
import type { App, Command } from "obsidian";
import { expect, it, vi } from "vitest";

import { registerWelcomeView } from "./register";
import type { WelcomeRegistrationDeps } from "./register";

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
