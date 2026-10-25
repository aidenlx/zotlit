import type { App, Command, Plugin, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { PlainCitationIndex } from "@/services/citation-index/plain";

import { openCitedByView, registerCitedByView } from "./register";
import { CITED_BY_VIEW_TYPE } from "./view";

describe("Cited By Sidebar registration", () => {
  it("stays closed until its command creates the right-side view", async () => {
    const setViewState = vi.fn(() => Promise.resolve());
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", { setViewState });
    const getLeavesOfType = vi.fn(() => [] as WorkspaceLeaf[]);
    const getRightLeaf = vi.fn(() => leaf);
    const revealLeaf = vi.fn(() => Promise.resolve());
    const app = stubService<App>("App", {
      workspace: stubService<App["workspace"]>("Workspace", {
        getLeavesOfType,
        getRightLeaf,
        revealLeaf,
      }),
    });
    let command: Command | undefined;
    const plugin = stubService<
      Pick<Plugin, "registerView" | "addCommand" | "app">
    >("Plugin", {
      app,
      registerView: vi.fn(),
      addCommand: vi.fn((next: Command) => {
        command = next;
        return next;
      }),
    });

    registerCitedByView(plugin, {
      app,
      citationIndex: stubService<PlainCitationIndex>("CitationIndex", {}),
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
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
    const getRightLeaf = vi.fn();
    const revealLeaf = vi.fn(() => Promise.resolve());
    const app = stubService<App>("App", {
      workspace: stubService<App["workspace"]>("Workspace", {
        getLeavesOfType: () => [leaf],
        getRightLeaf,
        revealLeaf,
      }),
    });

    await openCitedByView(app);

    expect(getRightLeaf).not.toHaveBeenCalled();
    expect(revealLeaf).toHaveBeenCalledWith(leaf);
  });
});
