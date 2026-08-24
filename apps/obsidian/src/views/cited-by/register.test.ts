import type { App, Command, Plugin, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { openCitedByView, registerCitedByView } from "./register";
import { CITED_BY_VIEW_TYPE } from "./view";

describe("Cited By Sidebar registration", () => {
  it("stays closed until its command creates the right-side view", async () => {
    const setViewState = vi.fn(() => Promise.resolve());
    const leaf = { setViewState } as unknown as WorkspaceLeaf;
    const getLeavesOfType = vi.fn(() => [] as WorkspaceLeaf[]);
    const getRightLeaf = vi.fn(() => leaf);
    const revealLeaf = vi.fn(() => Promise.resolve());
    const app = {
      workspace: { getLeavesOfType, getRightLeaf, revealLeaf },
    } as unknown as App;
    let command: Command | undefined;
    const plugin = {
      app,
      registerView: vi.fn(),
      addCommand: vi.fn((next: Command) => {
        command = next;
        return next;
      }),
    } as unknown as Pick<Plugin, "registerView" | "addCommand" | "app">;

    registerCitedByView(plugin, {
      app,
      citationIndex: {} as never,
    });
    expect(getRightLeaf).not.toHaveBeenCalled();

    command!.callback!();
    await vi.waitFor(() => expect(revealLeaf).toHaveBeenCalledWith(leaf));
    expect(setViewState).toHaveBeenCalledWith({
      type: CITED_BY_VIEW_TYPE,
      active: true,
    });
  });

  it("reveals the first existing view instead of creating another", async () => {
    const leaf = {} as WorkspaceLeaf;
    const getRightLeaf = vi.fn();
    const revealLeaf = vi.fn(() => Promise.resolve());
    const app = {
      workspace: {
        getLeavesOfType: () => [leaf],
        getRightLeaf,
        revealLeaf,
      },
    } as unknown as App;

    await openCitedByView(app);

    expect(getRightLeaf).not.toHaveBeenCalled();
    expect(revealLeaf).toHaveBeenCalledWith(leaf);
  });
});
