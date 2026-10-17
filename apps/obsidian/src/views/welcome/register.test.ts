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
