import type { App, Command } from "obsidian";
import { expect, it, vi } from "vitest";

import { openWelcomeView, registerWelcomeView } from "./register";
import type { WelcomeRegistrationDeps } from "./register";

vi.mock("./view", () => ({
  WELCOME_VIEW_TYPE: "zotlit-welcome",
  WelcomeView: vi.fn(),
}));

function setup(existing = false) {
  const revealed = Promise.withResolvers<void>();
  const leaf = { setViewState: vi.fn(async () => {}) };
  const workspace = {
    getLeavesOfType: vi.fn(() => (existing ? [leaf] : [])),
    getLeaf: vi.fn(() => leaf),
    revealLeaf: vi.fn(async () => revealed.resolve()),
  };
  return {
    app: { workspace } as unknown as App,
    workspace,
    leaf,
    revealed: revealed.promise,
  };
}

it("keeps first-launch Welcome in the active leaf", async () => {
  const { app, workspace, leaf } = setup();
  await openWelcomeView(app, { mode: "fresh" });
  expect(workspace.getLeaf).toHaveBeenCalledExactlyOnceWith(false);
  expect(leaf.setViewState).toHaveBeenCalledWith({
    type: "zotlit-welcome",
    active: true,
    state: { mode: "fresh" },
  });
});

it.each([false, true])(
  "the command preserves the active note and reuses existing Welcome (%s)",
  async (existing) => {
    const { app, workspace, leaf, revealed } = setup(existing);
    const commands: Command[] = [];
    registerWelcomeView(
      {
        app,
        manifest: {
          id: "zotlit",
          name: "ZotLit",
          description: "Zotero integration",
          version: "2.2.0",
          minAppVersion: "1.13.4",
          author: "AidenLx",
        },
        registerView: vi.fn(),
        register: vi.fn(),
        addCommand: (command) => {
          commands.push(command);
          return command;
        },
      },
      {
        app,
        settings: { current: { "release.migration-pending": true } },
        db: { on: vi.fn(() => () => {}) },
      } as unknown as WelcomeRegistrationDeps,
    );
    commands[0]!.callback!();
    await revealed;

    if (existing) expect(workspace.getLeaf).not.toHaveBeenCalled();
    else expect(workspace.getLeaf).toHaveBeenCalledExactlyOnceWith("tab");
    expect(leaf.setViewState).toHaveBeenCalledWith({
      type: "zotlit-welcome",
      active: true,
      state: { mode: "upgraded" },
    });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  },
);
